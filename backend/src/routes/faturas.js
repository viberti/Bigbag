// Rota de ingestão de faturas. PROTEGIDA por requireAuth (a app está exposta).
// POST /api/faturas  (multipart, campo "fatura" = imagem) →
//   extrai (VLM) → reconcilia → grava imagem + BD → devolve resumo.
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { extrairFatura, extrairFaturaDeTexto } from '../ingest/extract.js';
import { extrairTextoPdf } from '../ingest/pdf.js';
import { preProcessarImagem } from '../ingest/imagem.js';
import { distribuirDesconto, pistaCirurgica, validarLinhas } from '../ingest/reconcile.js';
import { persistirFatura } from '../ingest/persist.js';
import { extrairFormato, precoPorBase } from '../normaliza/formato.js';
import { normalizarItensFatura, mergeNomesIdenticos } from '../normaliza/matcher.js';
import { recomputarPpbFatura } from '../normaliza/ppb.js';
import { autoCorrigirOutliers } from '../normaliza/autoCorrige.js';
import { guardarMensagem } from '../historico.js';
import { enriquecerEansFatura } from '../ingest/enriquecer.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

export const faturasRouter = Router();

faturasRouter.post('/', requireAuth, upload.single('fatura'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta o arquivo "fatura" (imagem ou PDF)' });
    const origemCaptura = (String(req.body?.origem || '').trim() || null)?.slice(0, 16) || null;
    const mime = req.file.mimetype || 'application/octet-stream';
    const ehPdf = mime === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');

    // 1) extração — PDF (texto+LLM, Abordagem B) OU imagem (VLM, Abordagem A)
    let metodo;
    let reextrair; // (correcao?) → nova extração, para a auto-correção
    if (ehPdf) {
      const texto = await extrairTextoPdf(req.file.buffer);
      metodo = 'ocr_llm';
      reextrair = (correcao) => extrairFaturaDeTexto(texto, { correcao });
    } else {
      const img = await preProcessarImagem(req.file.buffer); // resize + contraste
      const imageBase64 = img.buffer.toString('base64');
      metodo = 'vlm';
      reextrair = (correcao) => extrairFatura({ imageBase64, mime: img.mime, correcao });
    }
    const reconciliar = (d) =>
      distribuirDesconto(d.itens, {
        descontoGlobal: Number(d.desconto_global) || 0,
        totalImpresso: d.total_impresso,
        iva: Number(d.iva) || 0,
      });

    // Pista para uma linha inconsistente (qtd×unitário ≠ total) — 2.ª camada.
    const hintLinhas = (linhas) => {
      if (!linhas?.length) return '';
      const l = linhas[0];
      return ` ATENÇÃO À LINHA "${l.descricao}": quantidade ${l.quantidade} × unitário ${l.preco_unitario} = ${l.esperado}, mas o "valor" lido foi ${l.valor}. O "valor" é o TOTAL da linha — corrige para ${l.esperado} (ou relê a quantidade/unitário).`;
    };
    // "Badness" combinada: discrepância do total + nº de linhas inconsistentes.
    const problemas = (r, linhas) => Math.abs(r.discrepancia) + (linhas?.length || 0);

    let dados = await reextrair();
    let rec = reconciliar(dados);
    let linhasInc = validarLinhas(dados.itens);

    // 1b) AUTO-CORREÇÃO — loop LIMITADO: realimenta a discrepância do total E as
    // inconsistências por linha (qtd×unitário≠total). Fica com o melhor; para ao
    // ficar limpo, ao não melhorar, ou ao atingir o limite.
    for (let i = 0; i < config.openrouter.maxCorrecoes && (!rec.extracaoBate || linhasInc.length) && dados.total_impresso != null; i++) {
      const hint = `A soma dos itens deu ${rec.subtotal} mas o total impresso é ${dados.total_impresso} (diferença ${rec.discrepancia}). Reverifica com atenção: itens a peso (usa o PREÇO IMPRESSO na linha, não kg×€/kg), descontos/promoções, e itens em falta ou a mais.${pistaCirurgica(rec.itens, rec.discrepancia)}${hintLinhas(linhasInc)} Devolve o JSON corrigido.`;
      let dados2;
      let rec2;
      let linhasInc2;
      try {
        dados2 = await reextrair(hint);
        rec2 = reconciliar(dados2);
        linhasInc2 = validarLinhas(dados2.itens);
      } catch {
        break; // erro na re-extração → mantém o melhor até agora
      }
      if (problemas(rec2, linhasInc2) < problemas(rec, linhasInc)) {
        dados = dados2;
        rec = rec2;
        linhasInc = linhasInc2;
      } else {
        break; // não melhorou → não insistir (evita gastar sem ganho)
      }
    }

    // snapshot do que foi extraído (antes da reconciliação), para debug
    const extracaoJson = {
      loja: dados.loja,
      data_compra: dados.data_compra,
      subtotal: dados.subtotal,
      desconto_global: dados.desconto_global,
      iva: dados.iva,
      total_impresso: dados.total_impresso,
      itens: dados.itens,
    };
    dados.itens = rec.itens; // reconciliados
    dados.iva = rec.iva; // IVA somado EFETIVO (0 se a legenda foi lida como espúria) → precos_com_iva

    // 2b) Camada 1 da normalização: formato → preco_por_base (€/kg, €/L, €/un)
    for (const it of dados.itens) {
      if (it.is_non_product) {
        it.preco_por_base = null;
        continue;
      }
      // o peso (itens a granel) vive em it.linha_peso, fora do nome — junta-se só
      // para derivar o formato/€-por-kg, sem poluir o descricao_original.
      const f = extrairFormato([it.descricao_original, it.linha_peso].filter(Boolean).join(' '));
      it.preco_por_base = precoPorBase({ preco_liquido: it.preco_liquido, quantidade: it.quantidade }, f);
    }

    // 3) gravar a imagem original
    await mkdir(config.uploads.faturas, { recursive: true });
    const ext = ehPdf ? 'pdf' : (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const ficheiro = path.join(config.uploads.faturas, `${randomUUID()}.${ext}`);
    await writeFile(ficheiro, req.file.buffer, { mode: 0o600 });

    // 4) persistir (com deduplicação)
    const resultado = await persistirFatura(getPool(), dados, {
      ficheiroOriginal: ficheiro,
      metodo,
      origemCaptura,
      modelo: ehPdf ? config.openrouter.model : config.openrouter.modelExtracao,
      totalReconciliado: rec.totalReconciliado,
      discrepancia: rec.discrepancia,
      needsReview: !rec.extracaoBate || linhasInc.length > 0,
      extracaoJson,
    });
    if (resultado.duplicada) {
      await unlink(ficheiro).catch(() => {}); // imagem órfã: a fatura já existia
      return res.json({
        duplicada: true,
        fatura_id: resultado.fatura_id,
        loja: dados.loja,
        data_compra: dados.data_compra,
        total_impresso: dados.total_impresso,
      });
    }
    const { fatura_id, loja_id, n_itens } = resultado;

    // 4b) Canonicalização inline (Camadas 2+3): resolve o sku_id de cada item já
    // na ingestão, para o produto aparecer com nome canónico (e corrigido) nas
    // consultas. Best-effort: se falhar, o item fica sem SKU e o script de lote
    // (normalizar_skus) apanha-o depois. Não bloqueia o upload em caso de erro.
    await normalizarItensFatura(getPool(), fatura_id, { cadeia: dados.loja?.cadeia }).catch((e) =>
      console.error('[faturas] canonicalização:', e.message),
    );

    // 4c) Recomputa o preco_por_base respeitando o unidade_base AUTORITATIVO do
    // SKU (agora resolvido) — garante que todos os itens do mesmo produto
    // comparam na mesma base (café sempre €/kg, ovos €/ovo). Best-effort.
    await recomputarPpbFatura(getPool(), fatura_id).catch((e) => console.error('[faturas] recomputar ppb:', e.message));

    // 4d) Auto-correção de outliers: se algum item desta nota ficou com ppb muito
    // fora da mediana do seu SKU (ex.: pack de 6/12 não capturado), tenta corrigir
    // (÷pack) e marca como inferido. Best-effort; só age quando está MUITO longe.
    await autoCorrigirOutliers(getPool(), { aplicar: true }).catch((e) =>
      console.error('[faturas] auto-correção ppb:', e.message),
    );

    // Funde automaticamente SKUs com nome idêntico criados por esta nota (evita
    // que duplicados de nome se acumulem). Só os nomes desta fatura. Best-effort.
    try {
      const [skuRows] = await getPool().query(
        'SELECT DISTINCT s.nome_canonico FROM item i JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.fatura_id = ?',
        [fatura_id],
      );
      await mergeNomesIdenticos(getPool(), new Set(skuRows.map((r) => r.nome_canonico)));
    } catch (e) {
      console.error('[faturas] merge idênticos:', e.message);
    }

    // 4e) Enriquece os EANs que vieram nas linhas do talão (Makro) via OFF →
    // os produtos ficam identificados e com ficha cheia, sem foto. Best-effort.
    await enriquecerEansFatura(getPool(), fatura_id).catch((e) => console.error('[faturas] enriquecer eans:', e.message));

    // Nome legível (canónico) por descrição, para o cartão mostrar o produto
    // limpo em vez do abreviado do talão. Best-effort.
    const canonPorDesc = {};
    try {
      const [rows] = await getPool().query(
        'SELECT i.descricao_original AS d, s.nome_canonico AS n FROM item i JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.fatura_id = ?',
        [fatura_id],
      );
      for (const r of rows) if (r.n) canonPorDesc[r.d] = r.n;
    } catch {
      /* sem canónico → cai para a descrição crua no cartão */
    }

    // Regista o upload na conversa, para o assistente ter contexto
    // ("a última fatura", "os valores dessa compra estão certos?").
    const dataCurta = String(dados.data_compra || '').slice(0, 10);
    await guardarMensagem(
      req.user.id,
      'assistant',
      `📄 ${dados.loja?.cadeia || dados.loja?.nome}, ${dataCurta}, total ${Number(dados.total_impresso).toFixed(2).replace('.', ',')} €, ${n_itens} itens.${rec.extracaoBate ? '' : ' (em revisão — diferença a confirmar)'}`,
    ).catch(() => {});

    // 5) resumo para o utilizador (inclui sinal de qualidade da extração)
    res.json({
      fatura_id,
      loja_id,
      metodo_extracao: metodo,
      loja: dados.loja,
      data_compra: dados.data_compra,
      total_impresso: dados.total_impresso,
      subtotal_extraido: Math.round(rec.subtotal * 100) / 100,
      total_reconciliado: Math.round(rec.totalReconciliado * 100) / 100,
      desconto_global: Number(dados.desconto_global) || 0,
      extracao_bate: rec.extracaoBate,
      needs_review: !rec.extracaoBate || linhasInc.length > 0,
      linhas_inconsistentes: linhasInc,
      discrepancia: rec.discrepancia,
      convencao: rec.convencao,
      n_itens,
      itens: dados.itens.map((it) => ({
        descricao_original: it.descricao_original,
        produto: canonPorDesc[it.descricao_original] || it.descricao_original,
        quantidade: Number(it.quantidade) || 1,
        preco_unitario: it.preco_unitario,
        preco_liquido: it.preco_liquido,
        preco_por_base: it.preco_por_base ?? null,
        desconto_direto: Number(it.desconto_direto) || 0,
        is_clearance: !!it.is_clearance,
        is_non_product: !!it.is_non_product,
      })),
    });
  } catch (e) {
    console.error('[faturas] erro:', e.message);
    res.status(502).json({ erro: 'Falha na ingestão', detalhe: e.message });
  }
});

// Lista as notas do utilizador (para a tela "As minhas compras"): data, loja,
// nº de itens, valor — por data decrescente.
faturasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const [notas] = await getPool().query(`
      SELECT f.id, f.data_compra AS data, COALESCE(l.cadeia, l.nome) AS loja,
             f.total_impresso AS total,
             (SELECT COUNT(*) FROM item i WHERE i.fatura_id = f.id AND i.is_non_product = 0) AS n_itens
        FROM fatura f JOIN loja l ON l.id = f.loja_id
       ORDER BY f.data_compra DESC, f.id DESC`);
    res.json({ notas });
  } catch (e) {
    console.error('[faturas GET] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar notas' });
  }
});

// Resumo de GASTOS para a análise doméstica: mês corrente, anterior, média, série
// mensal e repartição por loja do mês corrente. (Antes de '/:id' para não colidir.)
faturasRouter.get('/gastos', requireAuth, async (req, res) => {
  try {
    const [[hoje]] = await getPool().query('SELECT YEAR(CURDATE()) y, MONTH(CURDATE()) m');
    const [meses] = await getPool().query(`
      SELECT YEAR(data_compra) ano, MONTH(data_compra) mes,
             ROUND(SUM(total_impresso), 2) total, COUNT(*) n
        FROM fatura
       GROUP BY ano, mes ORDER BY ano, mes`);
    const acha = (y, m) => meses.find((x) => x.ano === y && x.mes === m) || { ano: y, mes: m, total: 0, n: 0 };
    const atual = acha(hoje.y, hoje.m);
    const pm = hoje.m === 1 ? { y: hoje.y - 1, m: 12 } : { y: hoje.y, m: hoje.m - 1 };
    const anterior = acha(pm.y, pm.m);
    const totais = meses.map((x) => Number(x.total));
    const media = totais.length ? +(totais.reduce((a, b) => a + b, 0) / totais.length).toFixed(2) : 0;
    const total_geral = +totais.reduce((a, b) => a + b, 0).toFixed(2);
    const variacao = anterior.total > 0 ? Math.round(((atual.total - anterior.total) / anterior.total) * 100) : null;
    const serie = meses.slice(-12);
    const [por_loja] = await getPool().query(`
      SELECT COALESCE(l.cadeia, l.nome) AS loja, ROUND(SUM(f.total_impresso), 2) AS total, COUNT(*) AS n
        FROM fatura f JOIN loja l ON l.id = f.loja_id
       WHERE YEAR(f.data_compra) = ? AND MONTH(f.data_compra) = ?
       GROUP BY loja ORDER BY total DESC`, [hoje.y, hoje.m]);
    res.json({ atual, anterior, media, total_geral, variacao, serie, por_loja });
  } catch (e) {
    console.error('[faturas/gastos] erro:', e.message);
    res.status(500).json({ erro: 'Falha a calcular gastos' });
  }
});

// Itens de UMA nota (ao tocar numa entrada da lista).
faturasRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[nota]] = await getPool().query(
      `SELECT f.id, f.data_compra AS data, COALESCE(l.cadeia, l.nome) AS loja, f.total_impresso AS total
         FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.id = ?`,
      [id],
    );
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada' });
    // A identificação (EAN/ficha) resolve-se por (descrição do talão + CADEIA), não por
    // item_id: identificar UMA compra de "Salada Gourmet" no Continente vale para TODAS
    // as compras Continente com o mesmo nome (mesmo produto). Entre cadeias não — pode
    // ser marca-própria diferente. `ident` é a ficha por (descrição, cadeia).
    const [itens] = await getPool().query(
      `SELECT i.id, i.sku_id, COALESCE(s.nome_canonico, i.descricao_original) AS produto,
              i.quantidade, i.preco_liquido AS preco, s.unidade_base, i.preco_por_base,
              COALESCE(i.ean, ident.ean) AS ean,
              ident.marca AS marca,
              pg.tipo AS tipo_alimento,
              (pg.nutricao IS NOT NULL) AS tem_generico,
              (
                COALESCE(ident.tem_ficha, 0) = 1
                OR pg.nutricao IS NOT NULL
                OR EXISTS (SELECT 1 FROM produto_ean pe
                             WHERE pe.ean = i.ean
                               AND (pe.off_json IS NOT NULL OR pe.vlm_json IS NOT NULL))
              ) AS tem_dados
         FROM item i
         LEFT JOIN sku_normalizado s ON s.id = i.sku_id
         LEFT JOIN produto_generico pg ON pg.sku_id = i.sku_id
         JOIN fatura f ON f.id = i.fatura_id
         JOIN loja l ON l.id = f.loja_id
         LEFT JOIN (
           SELECT i2.descricao_original AS d, COALESCE(l2.cadeia, l2.nome) AS chain,
                  MAX(pe.ean) AS ean,
                  MAX(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pe.off_json,'$.marca')), pe.marca)) AS marca,
                  MAX(pe.off_json IS NOT NULL OR pe.vlm_json IS NOT NULL) AS tem_ficha
             FROM produto_ean pe
             JOIN item i2 ON i2.id = pe.item_id
             JOIN fatura f2 ON f2.id = i2.fatura_id
             JOIN loja l2 ON l2.id = f2.loja_id
            WHERE pe.ean IS NOT NULL
            GROUP BY d, chain
         ) ident ON ident.d = i.descricao_original AND ident.chain = COALESCE(l.cadeia, l.nome)
        WHERE i.fatura_id = ? AND i.is_non_product = 0
        ORDER BY i.id`,
      [id],
    );
    res.json({ nota, itens });
  } catch (e) {
    console.error('[faturas/:id] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar nota' });
  }
});

// Serve a imagem original da nota (para a tela de revisão do operador).
faturasRouter.get('/:id/imagem', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[f]] = await getPool().query('SELECT ficheiro_original FROM fatura WHERE id = ?', [id]);
    if (!f?.ficheiro_original) return res.status(404).json({ erro: 'Sem imagem' });
    res.sendFile(f.ficheiro_original, (err) => {
      if (err && !res.headersSent) res.status(404).json({ erro: 'Imagem não encontrada' });
    });
  } catch (e) {
    console.error('[faturas/imagem] erro:', e.message);
    if (!res.headersSent) res.status(500).json({ erro: 'Falha a servir imagem' });
  }
});

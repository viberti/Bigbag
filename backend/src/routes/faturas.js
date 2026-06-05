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
import { distribuirDesconto } from '../ingest/reconcile.js';
import { persistirFatura } from '../ingest/persist.js';
import { extrairFormato, precoPorBase } from '../normaliza/formato.js';
import { normalizarItensFatura } from '../normaliza/matcher.js';
import { guardarMensagem } from '../historico.js';

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
      distribuirDesconto(d.itens, { descontoGlobal: Number(d.desconto_global) || 0, totalImpresso: d.total_impresso });

    let dados = await reextrair();
    let rec = reconciliar(dados);

    // 1b) AUTO-CORREÇÃO — loop LIMITADO: realimenta a discrepância e fica com o
    // melhor. Para ao reconciliar, ao não melhorar, ou ao atingir o limite.
    for (let i = 0; i < config.openrouter.maxCorrecoes && !rec.extracaoBate && dados.total_impresso != null; i++) {
      const hint = `A soma dos itens deu ${rec.subtotal} mas o total impresso é ${dados.total_impresso} (diferença ${rec.discrepancia}). Reverifica com atenção: itens a peso (usa o PREÇO IMPRESSO na linha, não kg×€/kg), descontos/promoções, e itens em falta ou a mais. Devolve o JSON corrigido.`;
      let dados2;
      let rec2;
      try {
        dados2 = await reextrair(hint);
        rec2 = reconciliar(dados2);
      } catch {
        break; // erro na re-extração → mantém o melhor até agora
      }
      if (Math.abs(rec2.discrepancia) < Math.abs(rec.discrepancia)) {
        dados = dados2;
        rec = rec2;
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
      total_impresso: dados.total_impresso,
      itens: dados.itens,
    };
    dados.itens = rec.itens; // reconciliados

    // 2b) Camada 1 da normalização: formato → preco_por_base (€/kg, €/L, €/un)
    for (const it of dados.itens) {
      if (it.is_non_product) {
        it.preco_por_base = null;
        continue;
      }
      const f = extrairFormato(it.descricao_original);
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
      needsReview: !rec.extracaoBate,
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
    await normalizarItensFatura(getPool(), fatura_id).catch((e) =>
      console.error('[faturas] canonicalização:', e.message),
    );

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
      `📄 Fatura adicionada: ${dados.loja?.cadeia || dados.loja?.nome}, ${dataCurta}, total ${Number(dados.total_impresso).toFixed(2).replace('.', ',')} €, ${n_itens} itens.${rec.extracaoBate ? '' : ' (em revisão — diferença a confirmar)'}`,
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
      needs_review: !rec.extracaoBate,
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

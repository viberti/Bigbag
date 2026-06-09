// Interface administrativa (operador). Tudo protegido por requireAuth.
// Três áreas:
//  1) SKUs canónicos — listar, renomear, associar/dissociar descrições, fundir.
//  2) Revisão de notas — imagem + itens, marcar certa/errada + comentário.
//  3) Fundir SKUs (ex.: "Burrata" + "Burrata de Búfala").
// Operações de escrita usam transação onde tocam em várias tabelas.
import { Router } from 'express';
import { unlink } from 'node:fs/promises';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';
import { similaridade, razaoCaractere } from '../normaliza/similaridade.js';
import { mergeNomesIdenticos } from '../normaliza/matcher.js';
import { pistaCirurgica, validarLinhas } from '../ingest/reconcile.js';
import { reprocessarFatura } from '../ingest/reprocess.js';
import { recomputarPpbSku } from '../normaliza/ppb.js';
import { autoCorrigirOutliers } from '../normaliza/autoCorrige.js';
import { marcaCompativel, precoPlausivel } from '../normaliza/validadores.js';
import { ln } from '../normaliza/mestre.js';
import { sugerirNomeCanonico } from '../ingest/produto.js';
import { candidatosCatalogo, proporMesmaLoja } from '../normaliza/resolverProduto.js';
import { mestrePorEan } from '../normaliza/mestreEan.js';

export const adminRouter = Router();

// Auto-correção de outliers de preco_por_base: corre uma "nova passada" que
// deteta ppb muito fora da mediana do SKU e tenta corrigir (pack não capturado).
// GET = pré-visualização (dry-run); POST = aplica. Devolve corrigidos + suspeitos.
adminRouter.get('/precos/outliers', async (req, res) => {
  try {
    res.json(await autoCorrigirOutliers(getPool(), { aplicar: false }));
  } catch (e) {
    console.error('[admin/precos/outliers] erro:', e.message);
    res.status(500).json({ erro: 'Falha a analisar outliers' });
  }
});
adminRouter.post('/precos/auto-corrigir', async (req, res) => {
  try {
    res.json(await autoCorrigirOutliers(getPool(), { aplicar: true }));
  } catch (e) {
    console.error('[admin/precos/auto-corrigir] erro:', e.message);
    res.status(500).json({ erro: 'Falha a auto-corrigir' });
  }
});
// Reverter uma correção inferida de um item (limpa a flag e recomputa o SKU).
adminRouter.post('/precos/reverter/:itemId', async (req, res) => {
  try {
    const id = Number(req.params.itemId);
    const [[it]] = await getPool().query('SELECT sku_id FROM item WHERE id = ?', [id]);
    await getPool().query('UPDATE item SET ppb_inferido = 0 WHERE id = ?', [id]);
    if (it?.sku_id) await recomputarPpbSku(getPool(), it.sku_id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/precos/reverter] erro:', e.message);
    res.status(500).json({ erro: 'Falha a reverter' });
  }
});
adminRouter.use(requireAuth);

const str = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max));
const normNome = (s) => String(s || '').trim().toLowerCase();
// peso/volume lido no nome ("330g", "475g"); fundir só se bater (OCR muda letras, não o pack).
const tamanhoNome = (d) => { const m = String(d || '').match(/(\d+\s*[x*]\s*)?\d+[.,]?\d*\s*(kg|gr?s?|ml|cl|lt|l|un|dz)\b/i); return m ? m[0].replace(/\s+/g, '').toLowerCase() : null; };
const mesmoTamanho = (a, b) => { const x = tamanhoNome(a), y = tamanhoNome(b); return !x || !y ? true : x === y; };

// === Sugestões de nome canónico (a partir das variantes em produto_nome) ===
// Lista as sugestões pendentes para o operador rever.
adminRouter.get('/nomes', async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT ns.sku_id, s.nome_canonico AS atual, ns.sugerido, ns.variantes
         FROM nome_sugestao ns JOIN sku_normalizado s ON s.id = ns.sku_id
        WHERE ns.estado = 'pendente' ORDER BY ns.sku_id`,
    );
    res.json({ sugestoes: rows.map((r) => ({ ...r, variantes: String(r.variantes || '').split('||').filter(Boolean) })) });
  } catch (e) {
    console.error('[admin/nomes] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar sugestões' });
  }
});

// Gera/atualiza sugestões (LLM) para os SKUs com variantes ainda sem decisão.
adminRouter.post('/nomes/gerar', async (req, res) => {
  try {
    const [skus] = await getPool().query(
      `SELECT s.id, s.nome_canonico AS atual, GROUP_CONCAT(pn.nome SEPARATOR '||') AS variantes
         FROM produto_nome pn JOIN sku_normalizado s ON s.id = pn.sku_id
        WHERE NOT EXISTS (SELECT 1 FROM nome_sugestao ns WHERE ns.sku_id = s.id AND ns.estado = 'rejeitado')
        GROUP BY s.id, s.nome_canonico`,
    );
    let novas = 0, custo = 0, erros = 0;
    for (const s of skus) {
      try {
        const variantes = String(s.variantes || '').split('||');
        const { nome, custo: c } = await sugerirNomeCanonico(variantes);
        custo += c || 0;
        if (!nome || normNome(nome) === normNome(s.atual)) continue;
        await getPool().query(
          `INSERT INTO nome_sugestao (sku_id, atual, sugerido, variantes, estado) VALUES (?,?,?,?,'pendente')
             ON DUPLICATE KEY UPDATE atual=VALUES(atual), sugerido=VALUES(sugerido), variantes=VALUES(variantes), estado='pendente', decidido_em=NULL`,
          [s.id, s.atual, nome, variantes.join('||')],
        );
        novas++;
      } catch (e) {
        erros++;
        console.error('[admin/nomes/gerar] sku', s.id, e.message);
      }
    }
    res.json({ novas, analisados: skus.length, custo, erros });
  } catch (e) {
    console.error('[admin/nomes/gerar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a gerar sugestões' });
  }
});

// Aplica uma sugestão (renomeia o SKU), com guarda anti-colisão.
adminRouter.post('/nomes/:skuId/aplicar', async (req, res) => {
  try {
    const skuId = Number(req.params.skuId);
    const [[ns]] = await getPool().query("SELECT sugerido FROM nome_sugestao WHERE sku_id = ? AND estado = 'pendente'", [skuId]);
    if (!ns) return res.status(404).json({ erro: 'Sugestão não encontrada' });
    const [[col]] = await getPool().query('SELECT id FROM sku_normalizado WHERE LOWER(nome_canonico) = LOWER(?) AND id <> ?', [ns.sugerido, skuId]);
    if (col) return res.status(409).json({ erro: `Colide com o produto #${col.id} (mesmo nome)` });
    await getPool().query('UPDATE sku_normalizado SET nome_canonico = ? WHERE id = ?', [ns.sugerido, skuId]);
    await getPool().query("UPDATE nome_sugestao SET estado = 'aplicado', decidido_em = NOW() WHERE sku_id = ?", [skuId]);
    res.json({ ok: true, nome: ns.sugerido });
  } catch (e) {
    console.error('[admin/nomes/aplicar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a aplicar' });
  }
});

// Rejeita uma sugestão (fica registada como rejeitada, não reaparece).
adminRouter.post('/nomes/:skuId/rejeitar', async (req, res) => {
  try {
    await getPool().query("UPDATE nome_sugestao SET estado = 'rejeitado', decidido_em = NOW() WHERE sku_id = ?", [Number(req.params.skuId)]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/nomes/rejeitar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a rejeitar' });
  }
});

// === Matching de EAN (nome do talão → catálogo Auchan/Continente) ===========
// Worklist da aba "EANs": o resolvedor propõe um EAN por nome de produto; o
// operador aprova (→ ganha EAN + ficha + nutrição) ou rejeita.

// Lista as propostas pendentes (+ nº de compras que cada nome representa).
adminRouter.get('/match-eans', async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT m.id, m.descricao, m.ean, m.nome_cand, m.marca, m.fonte, m.confianca,
              m.preco_pago, m.preco_cand, m.formato_pago, m.formato_cand, m.alternativas,
              (SELECT COUNT(*) FROM item i WHERE i.descricao_original = m.descricao AND i.is_non_product = 0) AS compras
         FROM match_ean_sugestao m
        WHERE m.estado = 'pendente' ORDER BY m.confianca DESC, m.descricao`,
    );
    res.json({ sugestoes: rows.map((r) => ({
      ...r,
      confianca: Number(r.confianca),
      preco_pago: r.preco_pago != null ? Number(r.preco_pago) : null,
      preco_cand: r.preco_cand != null ? Number(r.preco_cand) : null,
      alternativas: String(r.alternativas || '').split('||').filter(Boolean)
        .map((a) => { const [ean, nome, score] = a.split('|'); return { ean, nome, score: Number(score) || 0 }; }),
    })) });
  } catch (e) {
    console.error('[admin/match-eans] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar propostas' });
  }
});

// Gera propostas (candidatos do catálogo, SEM LLM — o operador é o juiz). Corre
// sobre nomes de produto AINDA sem EAN e sem proposta/rejeição, em lotes.
adminRouter.post('/match-eans/gerar', async (req, res) => {
  try {
    const pool = getPool();
    const limite = Math.min(Math.max(Number(req.body?.limite) || 60, 1), 200);
    // produtos distintos comprados, sem EAN (nem na linha nem identificado) e sem
    // proposta/rejeição já registada. Usa o nome canónico para pontuar se houver.
    // exclui frescos (fruta/legume/carne): não têm GTIN real — a nutrição vem do
    // NOME (produto_generico), não do matching por EAN. Mesmo critério do /por-identificar.
    const [itens] = await pool.query(
      `SELECT i.descricao_original AS d, MAX(COALESCE(l.cadeia, l.nome)) AS cadeia,
              MAX(s.nome_canonico) AS canon, AVG(i.preco_por_base) AS ppb,
              AVG(i.preco_liquido / GREATEST(i.quantidade, 1)) AS preco,  -- € por UNIDADE (a qtd da linha não infla o preço)
              MAX((SELECT pe.marca FROM produto_ean pe WHERE pe.item_id = i.id AND pe.marca IS NOT NULL LIMIT 1)) AS marca
         FROM item i
         JOIN fatura f ON f.id = i.fatura_id JOIN loja l ON l.id = f.loja_id
         LEFT JOIN sku_normalizado s ON s.id = i.sku_id
         LEFT JOIN produto_generico pg ON pg.sku_id = i.sku_id
        WHERE i.is_non_product = 0 AND i.ean IS NULL
          AND (pg.tipo IS NULL OR pg.tipo <> 'fresco')
          -- já identificado: QUALQUER compra com o MESMO nome já tem EAN (aprovar uma
          -- vale para todas — não re-propõe o que já casaste, mesmo que só 1 das compras
          -- tenha ganho a ficha produto_ean).
          AND NOT EXISTS (
            SELECT 1 FROM produto_ean pe JOIN item i2 ON i2.id = pe.item_id
             WHERE i2.descricao_original = i.descricao_original AND pe.ean IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM match_ean_sugestao m WHERE m.descricao = i.descricao_original)
        GROUP BY i.descricao_original
        LIMIT ?`, [limite]);

    let novas = 0, semCand = 0;
    for (const it of itens) {
      let prop;
      if (it.cadeia === 'Continente') {
        // MESMA LOJA: comida + preço-embalagem + marca-própria (frescos já excluídos).
        prop = await proporMesmaLoja(pool, {
          descricao: it.canon || it.d, descricaoRaw: it.d, marca: it.marca, preco: it.preco, preco_por_base: it.ppb,
        }, 'continente');
      } else {
        // Outras cadeias: porta de marca (cross-cadeia só com marca nacional explícita).
        const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, marca: it.marca, preco_por_base: it.ppb });
        const top = cand[0];
        if (top && top.score >= 0.4) prop = { ...top, confianca: top.score, alternativas: cand.slice(1, 4) };
      }
      if (!prop) { semCand++; continue; }
      const alt = (prop.alternativas || []).map((c) => `${c.ean}|${String(c.nome).slice(0, 80)}|${(c.score || 0).toFixed(2)}`).join('||');
      // peso/volume lido no nome do talão (ex.: "175GR", "6*1L", "4X115G")
      const mFmt = String(it.d).match(/(\d+\s*[x*]\s*)?\d+[.,]?\d*\s*(kg|gr?s?|m?l|cl|lt|un|dz)\b/i);
      const fmtPago = mFmt ? mFmt[0].replace(/\s+/g, '').toLowerCase().slice(0, 40) : null;
      await pool.query(
        `INSERT INTO match_ean_sugestao (descricao, ean, nome_cand, marca, fonte, confianca, preco_pago, preco_cand, formato_pago, formato_cand, alternativas, estado)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'pendente')
         ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome_cand=VALUES(nome_cand), marca=VALUES(marca),
           fonte=VALUES(fonte), confianca=VALUES(confianca), preco_pago=VALUES(preco_pago), preco_cand=VALUES(preco_cand),
           formato_pago=VALUES(formato_pago), formato_cand=VALUES(formato_cand), alternativas=VALUES(alternativas),
           estado='pendente', decidido_em=NULL`,
        [it.d, prop.ean, String(prop.nome).slice(0, 255), prop.marca, prop.fonte, prop.confianca,
          it.preco != null ? Number(it.preco).toFixed(2) : null, prop.preco != null ? Number(prop.preco).toFixed(2) : null,
          fmtPago, prop.formato ? String(prop.formato).slice(0, 60) : null, alt],
      );
      novas++;
    }
    res.json({ novas, analisados: itens.length, sem_candidato: semCand });
  } catch (e) {
    console.error('[admin/match-eans/gerar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a gerar propostas' });
  }
});

// Aprova uma proposta: o produto ganha o EAN escolhido + ficha (nutrição via OFF).
// Aceita ?ean no body para CORRIGIR (operador escolhe uma alternativa).
adminRouter.post('/match-eans/:id/aprovar', async (req, res) => {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    const [[sug]] = await pool.query("SELECT descricao, ean FROM match_ean_sugestao WHERE id = ? AND estado = 'pendente'", [id]);
    if (!sug) return res.status(404).json({ erro: 'Proposta não encontrada' });
    const ean = str(req.body?.ean, 20)?.replace(/\D/g, '') || sug.ean; // permite corrigir
    if (!ean || ean.length < 8) return res.status(400).json({ erro: 'EAN inválido' });

    // mestre por EAN: nomes + marca + categoria + nutrição (consulta OFF se preciso).
    const mestre = await mestrePorEan(pool, ean);
    const nome = (mestre?.nomes?.[0]) || sug.descricao;
    const marca = mestre?.marca || null;
    const categoria = mestre?.categoria || null;
    const nutricao = mestre?.nutricao ? JSON.stringify(mestre.nutricao) : null;
    const offJson = mestre?.off ? JSON.stringify(mestre.off) : null;

    // item representativo (o mais recente com este nome, ainda sem EAN) para a ficha.
    const [[it]] = await pool.query(
      `SELECT i.id, i.sku_id FROM item i JOIN fatura f ON f.id = i.fatura_id
        WHERE i.descricao_original = ? AND i.is_non_product = 0 AND i.ean IS NULL
          AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.item_id = i.id AND pe.ean IS NOT NULL)
        ORDER BY f.data_compra DESC, i.id DESC LIMIT 1`, [sug.descricao]);

    // UPSERT da ficha (produto_ean é UNIQUE por ean → uma ficha por produto).
    await pool.query(
      `INSERT INTO produto_ean (ean, item_id, sku_id, nome, marca, categoria, nutricao, fonte, off_json)
         VALUES (?,?,?,?,?,?,?, 'match', ?)
       ON DUPLICATE KEY UPDATE
         item_id = COALESCE(produto_ean.item_id, VALUES(item_id)),
         nome = COALESCE(produto_ean.nome, VALUES(nome)),
         marca = COALESCE(produto_ean.marca, VALUES(marca)),
         categoria = COALESCE(produto_ean.categoria, VALUES(categoria)),
         nutricao = COALESCE(produto_ean.nutricao, VALUES(nutricao)),
         off_json = COALESCE(produto_ean.off_json, VALUES(off_json))`,
      [ean, it?.id || null, it?.sku_id || null, nome, marca, categoria, nutricao, offJson],
    );

    // ciclo virtuoso: o nome do talão passa a ser uma variante CONHECIDA deste EAN
    // (melhora o matching futuro). INSERT IGNORE evita duplicar.
    await pool.query('INSERT IGNORE INTO produto_nome (ean, sku_id, nome, origem) VALUES (?,?,?,?)',
      [ean, it?.sku_id || null, sug.descricao, 'talao']).catch(() => {});

    // Propaga o EAN às compras do MESMO produto que diferem só por OCR (mesmo sku +
    // cadeia + descrição muito parecida + mesmo tamanho) → a câmara não reaparece
    // nessas (ex.: "CEREATS KELLOGGS" vs "CEREAIS KELLOGG S"). Grava em item.ean.
    try {
      if (it?.id && it?.sku_id) {
        const [[ch]] = await pool.query(
          'SELECT COALESCE(l.cadeia, l.nome) cadeia FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id WHERE i.id=? LIMIT 1', [it.id]);
        const [sibs] = await pool.query(
          `SELECT i.id, i.descricao_original d FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
            WHERE i.sku_id=? AND COALESCE(l.cadeia,l.nome)=? AND i.descricao_original<>? AND i.ean IS NULL
              AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL)`,
          [it.sku_id, ch?.cadeia || null, sug.descricao]);
        for (const sb of sibs) {
          if (mesmoTamanho(sug.descricao, sb.d) && razaoCaractere(sug.descricao, sb.d) >= 0.85) {
            await pool.query('UPDATE item SET ean = ? WHERE id = ?', [ean, sb.id]);
          }
        }
      }
    } catch (e) { console.error('[aprovar] propagar ocr:', e.message); }

    await pool.query("UPDATE match_ean_sugestao SET estado = 'aprovado', ean = ?, decidido_em = NOW() WHERE id = ?", [ean, id]);
    res.json({ ok: true, ean, nome, com_nutricao: !!nutricao });
  } catch (e) {
    console.error('[admin/match-eans/aprovar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a aprovar' });
  }
});

// Rejeita uma proposta (não reaparece).
adminRouter.post('/match-eans/:id/rejeitar', async (req, res) => {
  try {
    await getPool().query("UPDATE match_ean_sugestao SET estado = 'rejeitado', decidido_em = NOW() WHERE id = ?", [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/match-eans/rejeitar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a rejeitar' });
  }
});

// ───────────────────────── Painel (Admin v2) ─────────────────────────

// Cards do dashboard: nº de notas, por mercado, nº de produtos crus (antes da
// normalização), e o estado do modelo (SKUs, Mestres).
adminRouter.get('/painel', async (req, res) => {
  try {
    const pool = getPool();
    const [[notas]] = await pool.query('SELECT COUNT(*) AS n FROM fatura');
    const [porMercado] = await pool.query(
      `SELECT l.cadeia, COUNT(*) AS n FROM fatura f JOIN loja l ON l.id = f.loja_id
        GROUP BY l.cadeia ORDER BY n DESC`,
    );
    const [[crus]] = await pool.query(
      'SELECT COUNT(DISTINCT descricao_original) AS n FROM item WHERE is_non_product = 0',
    );
    const [[skus]] = await pool.query('SELECT COUNT(*) AS n FROM sku_normalizado');
    const [[mestres]] = await pool.query('SELECT COUNT(*) AS n FROM produto_mestre');
    const [[semMestre]] = await pool.query('SELECT COUNT(*) AS n FROM sku_normalizado WHERE mestre_id IS NULL');
    // EANs únicos conhecidos: distintos entre a identificação (produto_ean) e a
    // linha do talão (item.ean), juntos e sem repetir.
    const [[eans]] = await pool.query(
      `SELECT COUNT(*) AS n FROM (
         SELECT ean FROM produto_ean WHERE ean IS NOT NULL AND ean <> ''
         UNION
         SELECT ean FROM item WHERE ean IS NOT NULL AND ean <> ''
       ) e`,
    );
    res.json({
      n_notas: notas.n,
      por_mercado: porMercado,
      n_produtos_crus: crus.n,
      n_skus: skus.n,
      n_mestres: mestres.n,
      n_skus_sem_mestre: semMestre.n,
      n_eans_unicos: eans.n,
    });
  } catch (e) {
    console.error('[admin/painel] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar o painel' });
  }
});

// Captura CRUA: as descrições reais lidas das notas (antes da normalização),
// com quantas vezes, a loja, e a que produto canónico/Mestre caíram. ?q filtra.
adminRouter.get('/capturas', async (req, res) => {
  try {
    const q = str(req.query.q, 60);
    const like = q ? `%${q}%` : '%';
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const [rows] = await getPool().query(
      `SELECT i.descricao_original AS descricao, COUNT(*) AS n,
              MAX(l.cadeia) AS cadeia,
              MAX(s.nome_canonico) AS sku, MAX(s.mestre_id) AS mestre_id,
              MAX(m.nome) AS mestre
         FROM item i
         JOIN fatura f ON f.id = i.fatura_id
         JOIN loja l ON l.id = f.loja_id
         LEFT JOIN sku_normalizado s ON s.id = i.sku_id
         LEFT JOIN produto_mestre m ON m.id = s.mestre_id
        WHERE i.is_non_product = 0 AND i.descricao_original LIKE ?
        GROUP BY i.descricao_original
        ORDER BY n DESC LIMIT ${limit}`,
      [like],
    );
    res.json({ capturas: rows });
  } catch (e) {
    console.error('[admin/capturas] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar capturas' });
  }
});

// Produtos Mestre que AGRUPAM ≥2 SKUs (a de-fragmentação), com os SKUs reunidos
// e a marca de SUSPEITO dos validadores (unidade/€-base/marca-afinidade) — para
// o operador rever e separar o que estiver mal (override §11.4).
adminRouter.get('/mestres', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT s.id, s.nome_canonico AS nome, s.marca, s.unidade_base AS un, s.mestre_id,
              m.chave, m.categoria, m.nome AS mestre_nome,
              (SELECT AVG(i.preco_por_base) FROM item i WHERE i.sku_id = s.id AND i.preco_por_base IS NOT NULL) AS ppb
         FROM sku_normalizado s JOIN produto_mestre m ON m.id = s.mestre_id`,
    );
    const afin = new Map(); // marca→{categoria:contagem}
    for (const r of rows) {
      const mk = ln(r.marca);
      if (!mk || !r.categoria) continue;
      const a = afin.get(mk) || afin.set(mk, {}).get(mk);
      a[r.categoria] = (a[r.categoria] || 0) + 1;
    }
    const porMestre = new Map();
    for (const r of rows) (porMestre.get(r.mestre_id) || porMestre.set(r.mestre_id, []).get(r.mestre_id)).push(r);
    const mestres = [];
    for (const [mid, membros] of porMestre) {
      if (membros.length < 2) continue; // só os que agrupam
      const cat = membros[0].categoria;
      const unidades = new Set(membros.map((m) => m.un).filter(Boolean));
      const ppbs = membros.map((m) => Number(m.ppb)).filter((x) => Number.isFinite(x) && x > 0);
      const skus = membros.map((m) => {
        const motivos = [];
        if (unidades.size > 1) motivos.push('unidade ' + (m.un || '?'));
        if (!precoPlausivel(Number(m.ppb), ppbs)) motivos.push('€/base anómalo');
        if (!marcaCompativel(cat, afin.get(ln(m.marca)))) motivos.push('marca não faz "' + cat + '"');
        return { id: m.id, nome: m.nome, marca: m.marca, un: m.un, suspeito: motivos.length > 0, motivos };
      });
      mestres.push({ id: mid, chave: membros[0].chave, categoria: cat, nome: membros[0].mestre_nome, suspeito: skus.some((s) => s.suspeito), skus });
    }
    mestres.sort((a, b) => Number(b.suspeito) - Number(a.suspeito) || b.skus.length - a.skus.length);
    const [[sing]] = await pool.query('SELECT COUNT(*) n FROM (SELECT mestre_id FROM sku_normalizado WHERE mestre_id IS NOT NULL GROUP BY mestre_id HAVING COUNT(*) = 1) x');
    res.json({ mestres, n_singletons: sing.n });
  } catch (e) {
    console.error('[admin/mestres] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar Mestres' });
  }
});

// Override: separa um SKU do seu Mestre (mestre_id NULL) — o operador diz "isto
// não pertence aqui". Não-destrutivo (o SKU fica por reclassificar).
adminRouter.post('/mestres/desligar', async (req, res) => {
  try {
    const skuId = Number(req.body?.skuId);
    if (!skuId) return res.status(400).json({ erro: 'skuId obrigatório' });
    await getPool().query('UPDATE sku_normalizado SET mestre_id = NULL WHERE id = ?', [skuId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/mestres/desligar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a desligar' });
  }
});

// ───────────────────────── SKUs canónicos ─────────────────────────

// Lista SKUs com contagem de itens e de descrições associadas. ?q filtra por nome.
adminRouter.get('/skus', async (req, res) => {
  try {
    const q = str(req.query.q, 80);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    // Ordenação: 'nome' (default) · 'desc' (nº de descrições vindas das notas) · 'itens' (nº de compras).
    const ORDENS = {
      nome: 's.nome_canonico ASC',
      desc: 'n_desc DESC, n_itens DESC, s.nome_canonico ASC',
      itens: 'n_itens DESC, n_desc DESC, s.nome_canonico ASC',
    };
    const orderBy = ORDENS[req.query.ordenar] || ORDENS.nome;
    const args = [];
    let where = '';
    if (q) {
      where = 'WHERE s.nome_canonico LIKE ? OR s.marca LIKE ?';
      args.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await getPool().query(
      `SELECT s.id, s.nome_canonico, s.nome_simplificado, s.marca, s.categoria, s.unidade_base,
              COUNT(DISTINCT i.id) AS n_itens,
              COUNT(DISTINCT i.descricao_original) AS n_desc
         FROM sku_normalizado s
         LEFT JOIN item i ON i.sku_id = s.id
         ${where}
         GROUP BY s.id
         ORDER BY ${orderBy}
         LIMIT ${limit}`,
      args,
    );
    // Total de produtos canónicos (respeita o filtro de busca, ignora o limite).
    const [[{ total }]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM sku_normalizado s ${where}`,
      args,
    );
    res.json({ skus: rows, total });
  } catch (e) {
    console.error('[admin/skus] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar SKUs' });
  }
});

// Detalhe: SKU + descrições originais associadas (de itens) + aliases.
adminRouter.get('/skus/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [[sku]] = await pool.query('SELECT * FROM sku_normalizado WHERE id = ?', [id]);
    if (!sku) return res.status(404).json({ erro: 'SKU não encontrado' });
    const [descricoes] = await pool.query(
      `SELECT i.descricao_original AS descricao, COUNT(*) AS n, MAX(i.fatura_id) AS fatura_id
         FROM item i WHERE i.sku_id = ? GROUP BY i.descricao_original ORDER BY n DESC`,
      [id],
    );
    const [aliases] = await pool.query(
      'SELECT descricao_original AS descricao, origem FROM sku_alias WHERE sku_id = ? ORDER BY descricao_original',
      [id],
    );
    res.json({ sku, descricoes, aliases });
  } catch (e) {
    console.error('[admin/skus/:id] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar SKU' });
  }
});

// Renomear / editar o canónico.
adminRouter.patch('/skus/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nome = str(req.body?.nome_canonico, 120);
    if (!nome) return res.status(400).json({ erro: 'nome_canonico obrigatório' });
    const marca = req.body?.marca === undefined ? undefined : str(req.body.marca, 80);
    const categoria = req.body?.categoria === undefined ? undefined : str(req.body.categoria, 60);
    const simplificado = req.body?.nome_simplificado === undefined ? undefined : str(req.body.nome_simplificado, 120);
    const unidade = ['un', 'kg', 'L'].includes(req.body?.unidade_base) ? req.body.unidade_base : undefined;
    const sets = ['nome_canonico = ?'];
    const args = [nome];
    if (marca !== undefined) { sets.push('marca = ?'); args.push(marca || null); }
    if (categoria !== undefined) { sets.push('categoria = ?'); args.push(categoria || null); }
    if (simplificado !== undefined) { sets.push('nome_simplificado = ?'); args.push(simplificado || null); }
    if (unidade !== undefined) { sets.push('unidade_base = ?'); args.push(unidade); }
    args.push(id);
    await getPool().query(`UPDATE sku_normalizado SET ${sets.join(', ')} WHERE id = ?`, args);
    // Se a unidade mudou, recomputa o preco_por_base dos itens do SKU (a unidade
    // é autoritativa: café→kg passa todos a €/kg).
    let recomputados = 0;
    if (unidade !== undefined) recomputados = await recomputarPpbSku(getPool(), id).catch(() => 0);
    res.json({ ok: true, recomputados });
  } catch (e) {
    console.error('[admin/skus PATCH] erro:', e.message);
    res.status(500).json({ erro: 'Falha a atualizar SKU' });
  }
});

// Criar um produto canónico novo (do zero). O operador associa-lhe depois as
// descrições das lojas (POST /skus/:id/associar).
adminRouter.post('/skus', async (req, res) => {
  try {
    const nome = str(req.body?.nome_canonico, 120);
    if (!nome) return res.status(400).json({ erro: 'nome_canonico obrigatório' });
    const marca = str(req.body?.marca, 80) || null;
    const categoria = str(req.body?.categoria, 60) || null;
    const unidade = ['un', 'kg', 'L'].includes(req.body?.unidade_base) ? req.body.unidade_base : 'un';
    const [r] = await getPool().query(
      'INSERT INTO sku_normalizado (nome_canonico, marca, categoria, unidade_base) VALUES (?, ?, ?, ?)',
      [nome, marca, categoria, unidade],
    );
    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    console.error('[admin/skus POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a criar produto' });
  }
});

// Descrições de loja ainda SEM SKU (ou de outros SKUs) — para o operador
// descobrir o que pode associar a um produto. ?q filtra.
adminRouter.get('/descricoes-livres', async (req, res) => {
  try {
    const q = str(req.query.q, 60);
    const like = q ? `%${q}%` : '%';
    // MAX() nas colunas do SKU: descricao_original NÃO é chave de `item`, logo
    // sob ONLY_FULL_GROUP_BY não são funcionalmente dependentes do GROUP BY. Há
    // um só SKU por descrição (pós-normalização), por isso MAX devolve o valor certo.
    const [rows] = await getPool().query(
      `SELECT i.descricao_original AS descricao, COUNT(*) AS n,
              MAX(s.id) AS atual_id, MAX(s.nome_canonico) AS atual, MAX(s.unidade_base) AS atual_unidade,
              MAX(l.cadeia) AS cadeia
         FROM item i
         LEFT JOIN sku_normalizado s ON s.id = i.sku_id
         LEFT JOIN fatura f ON f.id = i.fatura_id
         LEFT JOIN loja l ON l.id = f.loja_id
        WHERE i.is_non_product = 0 AND i.descricao_original LIKE ?
        GROUP BY i.descricao_original ORDER BY n DESC LIMIT 80`,
      [like],
    );
    res.json({ descricoes: rows });
  } catch (e) {
    console.error('[admin/descricoes-livres] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar descrições' });
  }
});

// Associar uma descrição a este SKU (repõe os itens + grava o alias manual).
adminRouter.post('/skus/:id/associar', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const descricao = str(req.body?.descricao, 200);
    if (!descricao) return res.status(400).json({ erro: 'descricao obrigatória' });
    await conn.beginTransaction();
    const [up] = await conn.query('UPDATE item SET sku_id = ? WHERE descricao_original = ?', [id, descricao]);
    await conn.query(
      `INSERT INTO sku_alias (descricao_original, sku_id, origem, confianca) VALUES (?, ?, 'manual', 100)
         ON DUPLICATE KEY UPDATE sku_id = VALUES(sku_id), origem = 'manual', confianca = 100`,
      [descricao, id],
    );
    await conn.commit();
    res.json({ ok: true, itens_atualizados: up.affectedRows });
  } catch (e) {
    await conn.rollback();
    console.error('[admin/associar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a associar' });
  } finally {
    conn.release();
  }
});

// Dissociar uma descrição deste SKU (itens ficam sem SKU; remove o alias).
adminRouter.post('/skus/:id/dissociar', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const descricao = str(req.body?.descricao, 200);
    if (!descricao) return res.status(400).json({ erro: 'descricao obrigatória' });
    await conn.beginTransaction();
    const [up] = await conn.query(
      'UPDATE item SET sku_id = NULL WHERE descricao_original = ? AND sku_id = ?',
      [descricao, id],
    );
    await conn.query('DELETE FROM sku_alias WHERE descricao_original = ? AND sku_id = ?', [descricao, id]);
    await conn.commit();
    res.json({ ok: true, itens_atualizados: up.affectedRows });
  } catch (e) {
    await conn.rollback();
    console.error('[admin/dissociar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a dissociar' });
  } finally {
    conn.release();
  }
});

// Sugere pares de SKUs prováveis-mesmo-produto (variantes de leitura: "Batata
// Conservada Vermelha" vs "Batata Vermelha"), por similaridade de nome dentro
// do mesmo tipo de unidade. Para o operador rever e fundir num clique.
adminRouter.get('/sugestoes-merge', async (req, res) => {
  try {
    const limiar = Math.min(0.95, Math.max(0.3, Number(req.query.limiar) || 0.6));
    const [skus] = await getPool().query(
      `SELECT s.id, s.nome_canonico, s.marca, s.unidade_base, COUNT(i.id) AS n_itens
         FROM sku_normalizado s LEFT JOIN item i ON i.sku_id = s.id GROUP BY s.id`,
    );
    const pares = [];
    for (let i = 0; i < skus.length; i++) {
      for (let j = i + 1; j < skus.length; j++) {
        const a = skus[i];
        const b = skus[j];
        if (a.unidade_base !== b.unidade_base) continue; // só fundir o mesmo tipo
        const score = similaridade(a.nome_canonico, b.nome_canonico);
        if (score >= limiar) {
          // manter = o mais usado (canónico mais provável); fundir = o outro
          const [manter, fundir] = a.n_itens >= b.n_itens ? [a, b] : [b, a];
          pares.push({ score: Math.round(score * 100) / 100, manter, fundir });
        }
      }
    }
    pares.sort((x, y) => y.score - x.score);
    res.json({ pares: pares.slice(0, 100) });
  } catch (e) {
    console.error('[admin/sugestoes-merge] erro:', e.message);
    res.status(500).json({ erro: 'Falha a sugerir fusões' });
  }
});

// Auto-merge: funde TODOS os SKUs com nome canónico idêntico (normalizado) num
// só, mantendo o mais usado. Resolve a fragmentação de nomes iguais de uma vez.
adminRouter.post('/skus/auto-merge', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await mergeNomesIdenticos(conn);
    await conn.commit();
    res.json({ ok: true, grupos: r.grupos, skus_removidos: r.removidos });
  } catch (e) {
    await conn.rollback();
    console.error('[admin/auto-merge] erro:', e.message);
    res.status(500).json({ erro: 'Falha no auto-merge' });
  } finally {
    conn.release();
  }
});

// Fundir o SKU `de` no SKU `para` (repõe itens + aliases e apaga o `de`).
adminRouter.post('/skus/merge', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const de = Number(req.body?.de);
    const para = Number(req.body?.para);
    if (!de || !para || de === para) return res.status(400).json({ erro: 'de/para inválidos' });
    await conn.beginTransaction();
    const [[a]] = await conn.query('SELECT id FROM sku_normalizado WHERE id = ?', [de]);
    const [[b]] = await conn.query('SELECT id FROM sku_normalizado WHERE id = ?', [para]);
    if (!a || !b) {
      await conn.rollback();
      return res.status(404).json({ erro: 'SKU inexistente' });
    }
    const [up] = await conn.query('UPDATE item SET sku_id = ? WHERE sku_id = ?', [para, de]);
    // descricao_original é única no alias → repontar não gera conflito de chave
    await conn.query("UPDATE sku_alias SET sku_id = ?, origem = 'manual', confianca = 100 WHERE sku_id = ?", [para, de]);
    await conn.query('DELETE FROM sku_normalizado WHERE id = ?', [de]);
    await conn.commit();
    res.json({ ok: true, itens_movidos: up.affectedRows });
  } catch (e) {
    await conn.rollback();
    console.error('[admin/merge] erro:', e.message);
    res.status(500).json({ erro: 'Falha a fundir' });
  } finally {
    conn.release();
  }
});

// Worklist de revisão por CONFIANÇA: mostra primeiro o que mais provavelmente
// está mal — (a) itens sem SKU (não resolvidos) e (b) mapeamentos descrição→SKU
// de baixa confiança (ver migração 016). Ordenado do pior para o melhor, para o
// operador corrigir por prioridade (renomear/associar/fundir na aba Produtos).
adminRouter.get('/baixa-confianca', async (req, res) => {
  try {
    const limiar = Math.min(100, Math.max(1, Number(req.query.limiar) || 70));
    const pool = getPool();
    const [naoResolvidos] = await pool.query(
      `SELECT i.descricao_original AS descricao, COUNT(*) AS n_itens, MAX(l.cadeia) AS cadeia
         FROM item i JOIN fatura f ON f.id = i.fatura_id JOIN loja l ON l.id = f.loja_id
        WHERE i.sku_id IS NULL AND i.is_non_product = 0
        GROUP BY i.descricao_original ORDER BY n_itens DESC LIMIT 200`,
    );
    const [baixaConfianca] = await pool.query(
      `SELECT a.descricao_original AS descricao, a.confianca, a.origem,
              s.id AS sku_id, s.nome_canonico AS sku, s.unidade_base,
              COUNT(i.id) AS n_itens, MAX(l.cadeia) AS cadeia
         FROM sku_alias a
         JOIN sku_normalizado s ON s.id = a.sku_id
         LEFT JOIN item i ON i.descricao_original = a.descricao_original AND i.is_non_product = 0
         LEFT JOIN fatura f ON f.id = i.fatura_id
         LEFT JOIN loja l ON l.id = f.loja_id
        WHERE a.confianca < ?
        GROUP BY a.descricao_original
        HAVING n_itens > 0
        ORDER BY a.confianca ASC, n_itens DESC
        LIMIT 200`,
      [limiar],
    );
    // Aliases ainda sem pontuação (legado, antes da migração 016): NULL ≠ baixo.
    // Não os inflacionamos na lista; serão pontuados ao reprocessar a nota.
    const [[{ sem_pontuacao }]] = await pool.query(
      'SELECT COUNT(*) AS sem_pontuacao FROM sku_alias WHERE confianca IS NULL',
    );
    res.json({ limiar, naoResolvidos, baixaConfianca, semPontuacao: sem_pontuacao });
  } catch (e) {
    console.error('[admin/baixa-confianca] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar baixa confiança' });
  }
});

// ───────────────────────── Revisão de notas ─────────────────────────

// Lista de notas para revisão. ?status = pendente | erro | ok | all (default all).
adminRouter.get('/faturas', async (req, res) => {
  try {
    const status = str(req.query.status, 12) || 'all';
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    let having = '';
    if (status === 'pendente') having = 'HAVING veredicto IS NULL';
    else if (status === 'erro') having = "HAVING veredicto = 'erro'";
    else if (status === 'ok') having = "HAVING veredicto = 'ok'";
    const [rows] = await getPool().query(
      `SELECT f.id, l.cadeia, l.nome AS loja_nome, f.data_compra, f.total_impresso,
              f.needs_review, f.discrepancia, f.origem_captura, f.metodo_extracao,
              (SELECT COUNT(*) FROM item i WHERE i.fatura_id = f.id) AS n_itens,
              (SELECT r.veredicto FROM revisao r WHERE r.fatura_id = f.id ORDER BY r.id DESC LIMIT 1) AS veredicto
         FROM fatura f JOIN loja l ON l.id = f.loja_id
         ${having}
         ORDER BY f.id DESC
         LIMIT ${limit}`,
    );
    res.json({ faturas: rows });
  } catch (e) {
    console.error('[admin/faturas] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar notas' });
  }
});

// Detalhe de uma nota: cabeçalho + itens (cru + canónico) + última revisão.
adminRouter.get('/faturas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [[f]] = await pool.query(
      `SELECT f.*, l.cadeia, l.nome AS loja_nome, l.localizacao
         FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.id = ?`,
      [id],
    );
    if (!f) return res.status(404).json({ erro: 'Nota não encontrada' });
    const [itens] = await pool.query(
      `SELECT i.id, i.descricao_original, i.sku_id, s.nome_canonico, s.unidade_base,
              i.quantidade, i.preco_unitario, i.preco_liquido, i.preco_por_base,
              i.is_clearance, i.is_non_product
         FROM item i LEFT JOIN sku_normalizado s ON s.id = i.sku_id
         WHERE i.fatura_id = ? ORDER BY i.id`,
      [id],
    );
    const [[rev]] = await pool.query(
      'SELECT veredicto, comentario, criado_em FROM revisao WHERE fatura_id = ? ORDER BY id DESC LIMIT 1',
      [id],
    );
    const ext = String(f.ficheiro_original || '').split('.').pop().toLowerCase();
    const tipo_ficheiro = ext === 'pdf' ? 'pdf' : 'imagem';
    // Diagnóstico de reconciliação (computado do snapshot, sem coluna nova): a
    // pista cirúrgica + as linhas inconsistentes ajudam o operador a ver O QUE
    // está provavelmente errado, em vez de só "em revisão".
    let diagnostico = null;
    try {
      const ej = typeof f.extracao_json === 'string' ? JSON.parse(f.extracao_json) : f.extracao_json;
      if (ej?.itens) {
        const disc = Number(f.discrepancia) || 0;
        const pista = pistaCirurgica(ej.itens, disc).trim();
        const linhas = validarLinhas(ej.itens);
        if (f.needs_review || pista || linhas.length) {
          diagnostico = { discrepancia: disc, iva: ej.iva ?? null, pista: pista || null, linhas_inconsistentes: linhas };
        }
      }
    } catch {
      /* snapshot ausente/inválido → sem diagnóstico */
    }
    res.json({ fatura: f, itens, revisao: rev || null, diagnostico, imagem_url: `/api/faturas/${id}/imagem`, tipo_ficheiro });
  } catch (e) {
    console.error('[admin/faturas/:id] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar nota' });
  }
});

// Acerto da leitura por CADEIA e por ORIGEM de captura: taxa de reconciliação
// (sinal honesto) + vereditos do operador. É o que diz onde focar (regras por
// mercado? que caminho de captura lê melhor?).
adminRouter.get('/qualidade', async (req, res) => {
  try {
    const pool = getPool();
    const sql = (groupExpr) => `
      SELECT ${groupExpr} AS chave,
             COUNT(*) AS n,
             SUM(f.needs_review = 0) AS reconciliam,
             ROUND(AVG(ABS(f.discrepancia)), 3) AS disc_media,
             COUNT(r.id) AS revistas,
             SUM(r.veredicto = 'ok') AS rev_ok,
             SUM(r.veredicto = 'erro') AS rev_erro
        FROM fatura f
        JOIN loja l ON l.id = f.loja_id
        LEFT JOIN revisao r ON r.id = (SELECT MAX(r2.id) FROM revisao r2 WHERE r2.fatura_id = f.id)
        GROUP BY ${groupExpr}
        ORDER BY n DESC`;
    const [cadeias] = await pool.query(sql('l.cadeia'));
    const [origens] = await pool.query(sql("COALESCE(f.origem_captura, '—')"));
    const [metodos] = await pool.query(sql("COALESCE(f.metodo_extracao, '—')"));
    res.json({ cadeias, origens, metodos });
  } catch (e) {
    console.error('[admin/qualidade] erro:', e.message);
    res.status(500).json({ erro: 'Falha a calcular qualidade' });
  }
});

// Painel de SAÚDE do cesto: cruza as compras com a cache categoria_nutricao
// (nutrição pendurada na classe), preferindo a coorte FINA (categoria+variedade)
// e caindo para a categoria larga. Devolve NOVA, Nutri-Score, ultraprocessados e
// onde a confiança é baixa (dispersão larga → vale um scan). Ver
// docs/Visao_Conselheiro_Saude_Alimentar.md.
adminRouter.get('/saude', async (req, res) => {
  try {
    const pool = getPool();
    const [cn] = await pool.query('SELECT categoria, variedade, nutriscore, nova_group, dispersao FROM categoria_nutricao');
    const cache = new Map(cn.map((r) => [`${r.categoria}|${r.variedade || ''}`, r]));
    const look = (cat, vari) => cache.get(`${cat}|${vari}`) || cache.get(`${cat}|`) || null;
    const [its] = await pool.query(`
      SELECT m.categoria cat, SUBSTRING_INDEX(SUBSTRING_INDEX(m.chave,'|',5),'|',-1) AS vari, COUNT(i.id) n
        FROM produto_mestre m JOIN sku_normalizado s ON s.mestre_id = m.id
        JOIN item i ON i.sku_id = s.id AND i.is_non_product = 0
       GROUP BY m.categoria, vari`);
    const total = its.reduce((a, x) => a + x.n, 0);
    let comNut = 0, semNut = 0;
    const nova = {}, nutri = {}, ultra = {}, largas = {};
    for (const x of its) {
      const r = look(x.cat, x.vari || '');
      if (!r || (r.nova_group == null && r.nutriscore == null)) { semNut += x.n; continue; }
      comNut += x.n;
      if (r.nova_group != null) nova[r.nova_group] = (nova[r.nova_group] || 0) + x.n;
      if (r.nutriscore) nutri[r.nutriscore] = (nutri[r.nutriscore] || 0) + x.n;
      const rot = x.vari ? `${x.cat} ${x.vari}` : x.cat;
      if (String(r.nova_group) === '4') ultra[rot] = (ultra[rot] || 0) + x.n;
      if (r.dispersao === 'larga') largas[rot] = (largas[rot] || 0) + x.n;
    }
    const lista = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([rotulo, n]) => ({ rotulo, n }));
    res.json({ total, comNut, semNut, nova, nutri, ultra: lista(ultra), largas: lista(largas) });
  } catch (e) {
    console.error('[admin/saude] erro:', e.message);
    res.status(500).json({ erro: 'Falha a calcular saúde do cesto' });
  }
});

// Qualidade de PREÇO: para cada SKU com ≥2 observações, marca os itens cujo
// preco_por_base se afasta muito da mediana (>fator× ou <1/fator×). Apanha
// inconsistências de unidade/quantidade/formato — ovos per-caixa vs per-ovo,
// café per-pacote vs per-kg, leituras garbled — que distorcem a comparação.
// 2.ª camada de validação ao NÍVEL DO PRODUTO (a validarLinhas é dentro da nota).
adminRouter.get('/qualidade-preco', async (req, res) => {
  try {
    const fator = Math.min(Math.max(Number(req.query.fator) || 3, 1.5), 20);
    const [rows] = await getPool().query(
      `SELECT s.id sku_id, s.nome_canonico, s.unidade_base, i.id item_id, i.descricao_original,
              i.quantidade, i.preco_liquido, i.preco_por_base, i.fatura_id, l.cadeia,
              DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data
         FROM item i
         JOIN sku_normalizado s ON s.id = i.sku_id
         JOIN fatura f ON f.id = i.fatura_id
         JOIN loja l ON l.id = f.loja_id
        WHERE i.preco_por_base > 0 AND i.is_non_product = 0 AND i.is_clearance = 0`,
    );
    const porSku = new Map();
    for (const r of rows) {
      if (!porSku.has(r.sku_id)) porSku.set(r.sku_id, []);
      porSku.get(r.sku_id).push(r);
    }
    const mediana = (arr) => {
      const v = arr.map((x) => Number(x.preco_por_base)).sort((a, b) => a - b);
      const m = v.length >> 1;
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const grupos = [];
    for (const itens of porSku.values()) {
      if (itens.length < 2) continue;
      const med = mediana(itens);
      if (!(med > 0)) continue;
      const outliers = itens
        .filter((x) => Number(x.preco_por_base) > med * fator || Number(x.preco_por_base) < med / fator)
        .map((o) => ({
          item_id: o.item_id,
          fatura_id: o.fatura_id,
          descricao: o.descricao_original,
          quantidade: o.quantidade,
          preco_liquido: o.preco_liquido,
          preco_por_base: o.preco_por_base,
          cadeia: o.cadeia,
          data: o.data,
          desvio: Math.round((Number(o.preco_por_base) / med) * 10) / 10,
        }))
        .sort((a, b) => b.desvio - a.desvio);
      if (outliers.length)
        grupos.push({
          sku_id: itens[0].sku_id,
          nome: itens[0].nome_canonico,
          unidade_base: itens[0].unidade_base,
          mediana: Math.round(med * 10000) / 10000,
          n: itens.length,
          outliers,
        });
    }
    grupos.sort((a, b) => (b.outliers[0]?.desvio || 0) - (a.outliers[0]?.desvio || 0));
    res.json({ fator, grupos });
  } catch (e) {
    console.error('[admin/qualidade-preco] erro:', e.message);
    res.status(500).json({ erro: 'Falha a calcular qualidade de preço' });
  }
});

// Editar a quantidade/peso de um item (na base do SKU: un/kg/L) e recalcular o
// preco_por_base = preco_liquido / quantidade. É o que mantém a comparação de
// preços correta quando a extração leu mal o peso.
adminRouter.patch('/itens/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = Number(String(req.body?.quantidade ?? '').replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ erro: 'quantidade inválida' });
    const [[it]] = await getPool().query('SELECT preco_liquido FROM item WHERE id = ?', [id]);
    if (!it) return res.status(404).json({ erro: 'Item não encontrado' });
    const ppb = it.preco_liquido != null ? Math.round((Number(it.preco_liquido) / q) * 10000) / 10000 : null;
    await getPool().query('UPDATE item SET quantidade = ?, preco_por_base = ? WHERE id = ?', [q, ppb, id]);
    res.json({ ok: true, preco_por_base: ppb });
  } catch (e) {
    console.error('[admin/itens PATCH] erro:', e.message);
    res.status(500).json({ erro: 'Falha a atualizar item' });
  }
});

// Reprocessar a nota: re-corre a extração sobre o ficheiro guardado (apanha as
// melhorias de prompt/reconciliação) e substitui os itens. Substitui edições
// manuais nessa nota — usar quando a leitura saiu errada.
adminRouter.post('/faturas/:id/reprocessar', async (req, res) => {
  try {
    const r = await reprocessarFatura(getPool(), Number(req.params.id));
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[admin/reprocessar] erro:', e.message);
    res.status(500).json({ erro: 'Falha ao reprocessar', detalhe: e.message });
  }
});

// Apagar uma nota (itens + revisões + ficheiro + SKUs órfãos). Para notas com
// captura má — apaga e o utilizador re-digitaliza. Irreversível.
adminRouter.delete('/faturas/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  let ficheiro = null;
  try {
    const id = Number(req.params.id);
    await conn.beginTransaction();
    const [[f]] = await conn.query('SELECT ficheiro_original FROM fatura WHERE id = ?', [id]);
    if (!f) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Nota não encontrada' });
    }
    ficheiro = f.ficheiro_original;
    await conn.query('DELETE FROM revisao WHERE fatura_id = ?', [id]);
    await conn.query('DELETE FROM item WHERE fatura_id = ?', [id]);
    await conn.query('DELETE FROM fatura WHERE id = ?', [id]);
    // SKUs que ficaram sem nenhum item → remover (+ os seus aliases)
    const [orf] = await conn.query('SELECT s.id FROM sku_normalizado s LEFT JOIN item i ON i.sku_id = s.id WHERE i.id IS NULL');
    const ids = orf.map((o) => o.id);
    if (ids.length) {
      await conn.query('DELETE FROM sku_alias WHERE sku_id IN (?)', [ids]);
      await conn.query('DELETE FROM sku_normalizado WHERE id IN (?)', [ids]);
    }
    // Mestres que ficaram sem nenhum SKU a apontar → remover (de-fragmentação limpa).
    await conn.query('DELETE m FROM produto_mestre m WHERE NOT EXISTS (SELECT 1 FROM sku_normalizado s WHERE s.mestre_id = m.id)');
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error('[admin/faturas DELETE] erro:', e.message);
    return res.status(500).json({ erro: 'Falha a apagar a nota' });
  } finally {
    conn.release();
  }
  if (ficheiro) await unlink(ficheiro).catch(() => {}); // ficheiro fora da transação
  res.json({ ok: true });
});

// Guardar o veredicto do operador sobre a leitura.
adminRouter.post('/faturas/:id/revisao', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const veredicto = str(req.body?.veredicto, 8);
    if (veredicto !== 'ok' && veredicto !== 'erro') return res.status(400).json({ erro: "veredicto deve ser 'ok' ou 'erro'" });
    const comentario = str(req.body?.comentario, 2000);
    await getPool().query(
      'INSERT INTO revisao (fatura_id, veredicto, comentario, operador) VALUES (?, ?, ?, ?)',
      [id, veredicto, comentario, req.user?.id || null],
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/revisao] erro:', e.message);
    res.status(500).json({ erro: 'Falha a guardar revisão' });
  }
});

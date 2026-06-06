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
import { similaridade } from '../normaliza/similaridade.js';
import { mergeNomesIdenticos } from '../normaliza/matcher.js';
import { pistaCirurgica, validarLinhas } from '../ingest/reconcile.js';
import { reprocessarFatura } from '../ingest/reprocess.js';
import { recomputarPpbSku } from '../normaliza/ppb.js';
import { autoCorrigirOutliers } from '../normaliza/autoCorrige.js';

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

// ───────────────────────── SKUs canónicos ─────────────────────────

// Lista SKUs com contagem de itens e de descrições associadas. ?q filtra por nome.
adminRouter.get('/skus', async (req, res) => {
  try {
    const q = str(req.query.q, 80);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
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
         ORDER BY s.nome_canonico
         LIMIT ${limit}`,
      args,
    );
    res.json({ skus: rows });
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
    const [rows] = await getPool().query(
      `SELECT i.descricao_original AS descricao, COUNT(*) AS n, s.nome_canonico AS atual
         FROM item i LEFT JOIN sku_normalizado s ON s.id = i.sku_id
        WHERE i.is_non_product = 0 AND i.descricao_original LIKE ?
        GROUP BY i.descricao_original ORDER BY n DESC LIMIT 50`,
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
      `INSERT INTO sku_alias (descricao_original, sku_id, origem) VALUES (?, ?, 'manual')
         ON DUPLICATE KEY UPDATE sku_id = VALUES(sku_id), origem = 'manual'`,
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
    await conn.query("UPDATE sku_alias SET sku_id = ?, origem = 'manual' WHERE sku_id = ?", [para, de]);
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

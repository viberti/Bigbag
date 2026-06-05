// Interface administrativa (operador). Tudo protegido por requireAuth.
// Três áreas:
//  1) SKUs canónicos — listar, renomear, associar/dissociar descrições, fundir.
//  2) Revisão de notas — imagem + itens, marcar certa/errada + comentário.
//  3) Fundir SKUs (ex.: "Burrata" + "Burrata de Búfala").
// Operações de escrita usam transação onde tocam em várias tabelas.
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';

export const adminRouter = Router();
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
      `SELECT s.id, s.nome_canonico, s.marca, s.categoria, s.unidade_base,
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
      `SELECT i.descricao_original AS descricao, COUNT(*) AS n
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
    const sets = ['nome_canonico = ?'];
    const args = [nome];
    if (marca !== undefined) { sets.push('marca = ?'); args.push(marca || null); }
    if (categoria !== undefined) { sets.push('categoria = ?'); args.push(categoria || null); }
    args.push(id);
    await getPool().query(`UPDATE sku_normalizado SET ${sets.join(', ')} WHERE id = ?`, args);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/skus PATCH] erro:', e.message);
    res.status(500).json({ erro: 'Falha a atualizar SKU' });
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
      `SELECT i.id, i.descricao_original, i.sku_id, s.nome_canonico,
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
    res.json({ fatura: f, itens, revisao: rev || null, imagem_url: `/api/faturas/${id}/imagem` });
  } catch (e) {
    console.error('[admin/faturas/:id] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar nota' });
  }
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

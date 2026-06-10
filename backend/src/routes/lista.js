// Lista de compras PARTILHADA da família. Fonte de verdade no servidor (MySQL);
// os clientes sincronizam por polling curto enquanto a folha está aberta e fazem
// updates otimistas. Cada item guarda quem o adicionou e quem o riscou (cor do
// membro na UI). Preços: melhor preço unitário das ÚLTIMAS 3 compras do produto
// (e onde), + último preço no mercado selecionado (?mercado=) quando existe.
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';

export const listaRouter = Router();
listaRouter.use(requireAuth);

const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

// Preço de referência de um nome da lista: casa com o nome canónico (ou
// simplificado) do SKU — os habituais vêm daí, por isso batem; itens escritos à
// mão podem não casar (→ sem preço, honesto).
// Preços de TODOS os itens da lista em 2 queries (antes: 2 POR ITEM — e esta
// rota é polled a cada 4 s com a folha aberta). ROW_NUMBER particiona as últimas
// 3 compras por item da lista; o melhor calcula-se em JS.
async function precosDaLista(pool, itens, mercado) {
  if (!itens.length) return;
  const porId = new Map(itens.map((it) => [it.id, it]));
  const [ult3] = await pool.query(
    `SELECT t.lista_id, t.unit, t.loja FROM (
       SELECT li.id AS lista_id, i.preco_liquido / GREATEST(i.quantidade, 1) AS unit,
              COALESCE(l.cadeia, l.nome) AS loja,
              ROW_NUMBER() OVER (PARTITION BY li.id ORDER BY f.data_compra DESC, i.id DESC) AS rn
         FROM lista_item li
         JOIN sku_normalizado s ON LOWER(s.nome_canonico) = LOWER(li.nome) OR LOWER(COALESCE(s.nome_simplificado, '')) = LOWER(li.nome)
         JOIN item i ON i.sku_id = s.id AND i.is_non_product = 0
         JOIN fatura f ON f.id = i.fatura_id
         JOIN loja l ON l.id = f.loja_id
        WHERE li.estado IN ('ativo','carrinho')
     ) t WHERE t.rn <= 3`,
  );
  for (const r of ult3) {
    const it = porId.get(r.lista_id);
    if (it && (it.melhor_preco == null || Number(r.unit) < it.melhor_preco)) {
      it.melhor_preco = num(r.unit);
      it.melhor_loja = r.loja;
    }
  }
  if (mercado) {
    const [no] = await pool.query(
      `SELECT t.lista_id, t.unit FROM (
         SELECT li.id AS lista_id, i.preco_liquido / GREATEST(i.quantidade, 1) AS unit,
                ROW_NUMBER() OVER (PARTITION BY li.id ORDER BY f.data_compra DESC, i.id DESC) AS rn
           FROM lista_item li
           JOIN sku_normalizado s ON LOWER(s.nome_canonico) = LOWER(li.nome) OR LOWER(COALESCE(s.nome_simplificado, '')) = LOWER(li.nome)
           JOIN item i ON i.sku_id = s.id AND i.is_non_product = 0
           JOIN fatura f ON f.id = i.fatura_id
           JOIN loja l ON l.id = f.loja_id AND COALESCE(l.cadeia, l.nome) = ?
          WHERE li.estado IN ('ativo','carrinho')
       ) t WHERE t.rn = 1`,
      [mercado],
    );
    for (const r of no) { const it = porId.get(r.lista_id); if (it) it.preco_mercado = num(r.unit); }
  }
  for (const it of itens) {
    it.melhor_preco ??= null; it.melhor_loja ??= null; it.preco_mercado ??= null;
  }
}

// Lista atual (ativos + riscados) com preços, e as lojas conhecidas p/ o seletor.
listaRouter.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const mercado = String(req.query.mercado || '').trim() || null;
    const [itens] = await pool.query(
      `SELECT id, nome, quantidade, categoria, estado, adicionado_por, marcado_por
         FROM lista_item WHERE estado IN ('ativo','carrinho') ORDER BY criado_em, id`,
    );
    await precosDaLista(pool, itens, mercado);
    const [lojas] = await pool.query(
      `SELECT DISTINCT COALESCE(l.cadeia, l.nome) AS loja FROM fatura f JOIN loja l ON l.id = f.loja_id ORDER BY 1`,
    );
    res.json({ itens, lojas: lojas.map((x) => x.loja).filter(Boolean), mercado });
  } catch (e) {
    console.error('[lista] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar a lista' });
  }
});

// ── Lista PESSOAL do membro (ex.: itens que só a Sue consome) ────────────────
// Fonte rápida para passar itens à lista da casa com um toque ("+").
listaRouter.get('/pessoal', async (req, res) => {
  try {
    const [itens] = await getPool().query(
      'SELECT id, nome FROM lista_pessoal WHERE utilizador = ? ORDER BY nome',
      [req.user.id],
    );
    res.json({ itens });
  } catch (e) {
    console.error('[lista/pessoal] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar a lista pessoal' });
  }
});

listaRouter.post('/pessoal', async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim().slice(0, 160);
    if (!nome) return res.status(400).json({ erro: 'nome em falta' });
    await getPool().query('INSERT IGNORE INTO lista_pessoal (utilizador, nome) VALUES (?, ?)', [req.user.id, nome]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[lista/pessoal POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a adicionar' });
  }
});

listaRouter.delete('/pessoal/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'id inválido' });
    await getPool().query('DELETE FROM lista_pessoal WHERE id = ? AND utilizador = ?', [id, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[lista/pessoal DELETE] erro:', e.message);
    res.status(500).json({ erro: 'Falha a remover' });
  }
});

// Adicionar (dedup por nome, case-insensitive): se já está na lista, soma a
// quantidade — duas pessoas a adicionar "Leite" não criam duplicados.
listaRouter.post('/', async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim().slice(0, 160);
    if (!nome) return res.status(400).json({ erro: 'nome em falta' });
    const qtd = Math.max(1, Math.min(99, Number(req.body?.quantidade) || 1));
    const categoria = String(req.body?.categoria || '').trim().slice(0, 80) || null;
    const pool = getPool();
    const [[ja]] = await pool.query(
      `SELECT id, quantidade FROM lista_item WHERE estado IN ('ativo','carrinho') AND LOWER(nome) = LOWER(?) LIMIT 1`,
      [nome],
    );
    if (ja) {
      if (req.body?.somar) await pool.query('UPDATE lista_item SET quantidade = quantidade + ? WHERE id = ?', [qtd, ja.id]);
      return res.json({ ok: true, id: ja.id, existia: true });
    }
    const [r] = await pool.query(
      'INSERT INTO lista_item (nome, quantidade, categoria, adicionado_por) VALUES (?,?,?,?)',
      [nome, qtd, categoria, req.user.id],
    );
    res.json({ ok: true, id: r.insertId, existia: false });
  } catch (e) {
    console.error('[lista POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a adicionar' });
  }
});

// Alterar: quantidade e/ou riscar ("no carrinho", fica visível com a cor de quem
// riscou) / desriscar.
listaRouter.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'id inválido' });
    const sets = [], vals = [];
    if ('quantidade' in (req.body || {})) {
      const q = Math.max(1, Math.min(99, Number(req.body.quantidade) || 1));
      sets.push('quantidade = ?');
      vals.push(q);
    }
    if ('marcado' in (req.body || {})) {
      if (req.body.marcado) {
        sets.push("estado = 'carrinho'", 'marcado_por = ?');
        vals.push(req.user.id);
      } else {
        sets.push("estado = 'ativo'", 'marcado_por = NULL');
      }
    }
    if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });
    vals.push(id);
    await getPool().query(`UPDATE lista_item SET ${sets.join(', ')} WHERE id = ? AND estado IN ('ativo','carrinho')`, vals);
    res.json({ ok: true });
  } catch (e) {
    console.error('[lista PATCH] erro:', e.message);
    res.status(500).json({ erro: 'Falha a atualizar' });
  }
});

// Remover (swipe) — soft delete, preserva histórico.
listaRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'id inválido' });
    await getPool().query("UPDATE lista_item SET estado = 'removido' WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[lista DELETE] erro:', e.message);
    res.status(500).json({ erro: 'Falha a remover' });
  }
});

// Esvaziar a lista (tudo → removido).
listaRouter.post('/limpar', async (req, res) => {
  try {
    await getPool().query("UPDATE lista_item SET estado = 'removido' WHERE estado IN ('ativo','carrinho')");
    res.json({ ok: true });
  } catch (e) {
    console.error('[lista/limpar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a limpar' });
  }
});

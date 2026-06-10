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
async function precosDe(pool, nome, mercado) {
  const [ult3] = await pool.query(
    `SELECT i.preco_liquido / GREATEST(i.quantidade, 1) AS unit, COALESCE(l.cadeia, l.nome) AS loja
       FROM item i
       JOIN sku_normalizado s ON s.id = i.sku_id
       JOIN fatura f ON f.id = i.fatura_id
       JOIN loja l ON l.id = f.loja_id
      WHERE i.is_non_product = 0
        AND (LOWER(s.nome_canonico) = LOWER(?) OR LOWER(COALESCE(s.nome_simplificado, '')) = LOWER(?))
      ORDER BY f.data_compra DESC, i.id DESC
      LIMIT 3`,
    [nome, nome],
  );
  let melhor = null;
  for (const r of ult3) if (!melhor || Number(r.unit) < Number(melhor.unit)) melhor = r;
  let precoMercado = null;
  if (mercado) {
    const [[m]] = await pool.query(
      `SELECT i.preco_liquido / GREATEST(i.quantidade, 1) AS unit
         FROM item i
         JOIN sku_normalizado s ON s.id = i.sku_id
         JOIN fatura f ON f.id = i.fatura_id
         JOIN loja l ON l.id = f.loja_id
        WHERE i.is_non_product = 0
          AND (LOWER(s.nome_canonico) = LOWER(?) OR LOWER(COALESCE(s.nome_simplificado, '')) = LOWER(?))
          AND COALESCE(l.cadeia, l.nome) = ?
        ORDER BY f.data_compra DESC, i.id DESC
        LIMIT 1`,
      [nome, nome, mercado],
    );
    precoMercado = m ? num(m.unit) : null;
  }
  return { melhor_preco: melhor ? num(melhor.unit) : null, melhor_loja: melhor?.loja || null, preco_mercado: precoMercado };
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
    for (const it of itens) Object.assign(it, await precosDe(pool, it.nome, mercado));
    const [lojas] = await pool.query(
      `SELECT DISTINCT COALESCE(l.cadeia, l.nome) AS loja FROM fatura f JOIN loja l ON l.id = f.loja_id ORDER BY 1`,
    );
    res.json({ itens, lojas: lojas.map((x) => x.loja).filter(Boolean), mercado });
  } catch (e) {
    console.error('[lista] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar a lista' });
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

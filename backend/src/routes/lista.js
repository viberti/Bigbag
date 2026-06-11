// Lista de compras PARTILHADA da família. Fonte de verdade no servidor (MySQL);
// os clientes sincronizam por polling curto enquanto a folha está aberta e fazem
// updates otimistas. Cada item guarda quem o adicionou e quem o riscou (cor do
// membro na UI). Preços: melhor preço unitário das ÚLTIMAS 3 compras do produto
// (e onde), + último preço no mercado selecionado (?mercado=) quando existe.
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';
import { grupoDeTexto, tokenCasa } from '../normaliza/categoria.js';

export const listaRouter = Router();
listaRouter.use(requireAuth);

const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Casa um NOME de lista ("Leite", "Presunto") aos SKUs por TOKENS-palavra (não
// igualdade exata — "Leite" tem de casar "Leite Meio Gordo"). Prioriza o
// SUBSTANTIVO-CABEÇA: "Leite" prefere SKUs que COMEÇAM por "Leite", não "Doce de
// Leite" (mesma regra do matchProduto da consulta). Fracos só se não houver fortes.
function skusDoNome(nome, skus) {
  const q = norm(nome).split(' ').filter((t) => t.length >= 2);
  if (!q.length) return [];
  const fortes = [], fracos = [];
  for (const s of skus) {
    const nt = norm(`${s.nome_canonico} ${s.nome_simplificado || ''}`).split(' ').filter(Boolean);
    const casa = q.every((qt) => nt.some((w) => tokenCasa(w, qt)));
    if (!casa) continue;
    const head = norm(s.nome_canonico).split(' ')[0] || '';
    (head.startsWith(q[0]) ? fortes : fracos).push(s);
  }
  return fortes.length ? fortes : fracos;
}

// Hábitos de compra por SKU: nº de idas em que apareceu e unidades por ida.
// Base do "produto sugerido" e da "quantidade habitual" da lista inteligente.
async function habitosDosSkus(pool, skuIds) {
  if (!skuIds.length) return new Map();
  const ph = skuIds.map(() => '?').join(',');
  const [hist] = await pool.query(
    `SELECT i.sku_id, i.fatura_id, SUM(GREATEST(i.quantidade,1)) AS q
       FROM item i WHERE i.sku_id IN (${ph}) AND i.is_non_product = 0
      GROUP BY i.sku_id, i.fatura_id`, skuIds);
  const habito = new Map(); // sku_id → {idas, soma}
  for (const r of hist) {
    const h = habito.get(r.sku_id) || { idas: 0, soma: 0 };
    h.idas++; h.soma += Number(r.q) || 1;
    habito.set(r.sku_id, h);
  }
  return habito;
}

// Resolve preço + GRUPO de cada item da lista. Carrega os SKUs uma vez (tabela
// pequena), casa por tokens, e pede os preços recentes desses SKUs numa query só.
async function resolverItensLista(pool, itens, mercado) {
  if (!itens.length) return;
  const [skus] = await pool.query('SELECT id, nome_canonico, nome_simplificado, grupo FROM sku_normalizado');
  const skuIdsPorItem = new Map();   // lista_id → Set(sku_id)
  const allSkuIds = new Set();
  for (const it of itens) {
    const matched = skusDoNome(it.nome, skus);
    skuIdsPorItem.set(it.id, new Set(matched.map((s) => s.id)));
    for (const s of matched) allSkuIds.add(s.id);
    // GRUPO (ponto 3): do SKU casado (1.º com grupo definido); senão do NOME.
    it.grupo = matched.find((s) => s.grupo && s.grupo !== 'outros')?.grupo || grupoDeTexto(it.nome);
    it.melhor_preco = null; it.melhor_loja = null; it.preco_mercado = null; it.unidade_base = null;
    it.produto_sugerido = null; it.variantes_n = 0; it.qtd_habitual = null;
  }
  if (!allSkuIds.size) return;
  const ids = [...allSkuIds];
  const ph = ids.map(() => '?').join(',');
  // últimas 3 compras (por SKU) — para cada item escolhemos o melhor entre os seus SKUs.
  // PREÇO = preco_por_base (€/L, €/kg, €/un): comparável entre tamanhos de embalagem.
  // preco_liquido/quantidade dava o preço POR UNIDADE DO PACK (9 mini-garrafas de
  // 200ml a 0,31 contaminavam o mínimo do "leite"). Quando não há ppb (peso não
  // extraído, ex.: Farinha) cai para preco_unitario (preço da embalagem, sem unidade).
  const [rows] = await pool.query(
    `SELECT sku_id, ppb, pu, unidade, loja, data FROM (
       SELECT i.sku_id, i.preco_por_base AS ppb, i.preco_unitario AS pu, s.unidade_base AS unidade, COALESCE(l.cadeia,l.nome) AS loja,
              f.data_compra AS data, ROW_NUMBER() OVER (PARTITION BY i.sku_id ORDER BY f.data_compra DESC, i.id DESC) AS rn
         FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id JOIN sku_normalizado s ON s.id=i.sku_id
        WHERE i.sku_id IN (${ph}) AND i.is_non_product=0 AND i.is_clearance=0 AND (i.preco_por_base IS NOT NULL OR i.preco_unitario IS NOT NULL)
     ) t WHERE t.rn <= 3`, ids);
  // preço no mercado selecionado (a compra mais recente nesse mercado), por SKU
  let noMercado = new Map();
  if (mercado) {
    const [mrows] = await pool.query(
      `SELECT sku_id, ppb, pu, unidade FROM (
         SELECT i.sku_id, i.preco_por_base AS ppb, i.preco_unitario AS pu, s.unidade_base AS unidade,
                ROW_NUMBER() OVER (PARTITION BY i.sku_id ORDER BY f.data_compra DESC, i.id DESC) AS rn
           FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id AND COALESCE(l.cadeia,l.nome)=? JOIN sku_normalizado s ON s.id=i.sku_id
          WHERE i.sku_id IN (${ph}) AND i.is_non_product=0 AND i.is_clearance=0 AND (i.preco_por_base IS NOT NULL OR i.preco_unitario IS NOT NULL)
       ) t WHERE t.rn=1`, [mercado, ...ids]);
    noMercado = new Map(mrows.map((r) => [r.sku_id, r]));
  }
  const recentePorSku = new Map(); // sku_id → [{ppb, pu, unidade, loja}]
  for (const r of rows) (recentePorSku.get(r.sku_id) || recentePorSku.set(r.sku_id, []).get(r.sku_id)).push(r);
  // HÁBITOS da casa (lista inteligente, fase 1): por SKU casado, em quantas idas
  // foi comprado e quantas unidades por ida. Alimenta o "produto sugerido" (o que
  // ESTA casa compra quando escreve "iogurte"), o nº de opções (abre o seletor de
  // variantes) e a quantidade habitual. Determinístico — o histórico é a inteligência.
  const habitoPorSku = await habitosDosSkus(pool, ids);
  const skuById = new Map(skus.map((s) => [s.id, s]));
  // Por item: preferimos €/base (comparável) ao preço de embalagem. Só caímos para
  // a embalagem (pu) se NENHUM dos SKUs casados tiver ppb — evita misturar unidades.
  for (const it of itens) {
    let base = null, emb = null;  // {v, loja, unidade}
    const considera = (r, loja) => {
      if (r.ppb != null) { if (!base || num(r.ppb) < base.v) base = { v: num(r.ppb), loja, unidade: r.unidade }; }
      else if (r.pu != null) { if (!emb || num(r.pu) < emb.v) emb = { v: num(r.pu), loja, unidade: null }; }
    };
    for (const sid of skuIdsPorItem.get(it.id) || []) {
      for (const r of recentePorSku.get(sid) || []) considera(r, r.loja);
    }
    const esc = base || emb;
    if (esc) { it.melhor_preco = esc.v; it.melhor_loja = esc.loja; it.unidade_base = esc.unidade; }
    // produto sugerido = a variante MAIS comprada entre os SKUs casados (idas);
    // qtd habitual = unidades/ida dessa variante. Só variantes com compras contam.
    const compr = [...(skuIdsPorItem.get(it.id) || [])]
      .map((sid) => ({ sid, h: habitoPorSku.get(sid) }))
      .filter((x) => x.h)
      .sort((a, b) => b.h.idas - a.h.idas);
    it.variantes_n = compr.length;
    if (compr.length) {
      it.produto_sugerido = skuById.get(compr[0].sid)?.nome_canonico || null;
      it.qtd_habitual = Math.max(1, Math.round(compr[0].h.soma / compr[0].h.idas));
    }
    for (const sid of skuIdsPorItem.get(it.id) || []) {
      const m = mercado ? noMercado.get(sid) : null;
      if (!m) continue;
      const mv = m.ppb != null ? num(m.ppb) : (m.pu != null ? num(m.pu) : null);
      const mu = m.ppb != null ? m.unidade : null;
      if (mv != null && (it.preco_mercado == null || mv < it.preco_mercado)) { it.preco_mercado = mv; it.unidade_base = mu; }
    }
  }
}

// Variantes HABITUAIS de um item da lista ("iogurte" → os iogurtes que ESTA casa
// compra, por frequência, com preço e loja) — o utilizador escolhe e o item
// concretiza-se (PATCH nome). Determinístico: histórico + matching por tokens.
listaRouter.get('/variantes', async (req, res) => {
  try {
    const nome = String(req.query.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'nome em falta' });
    const pool = getPool();
    const [skus] = await pool.query('SELECT id, nome_canonico, nome_simplificado, grupo FROM sku_normalizado');
    const matched = skusDoNome(nome, skus);
    if (!matched.length) return res.json({ variantes: [] });
    const ids = matched.map((s) => s.id);
    const ph = ids.map(() => '?').join(',');
    const habito = await habitosDosSkus(pool, ids);
    // preço mais recente por SKU (€/base quando há; senão preço de embalagem)
    const [prec] = await pool.query(
      `SELECT sku_id, ppb, pu, unidade, loja FROM (
         SELECT i.sku_id, i.preco_por_base AS ppb, i.preco_unitario AS pu, s.unidade_base AS unidade,
                COALESCE(l.cadeia,l.nome) AS loja,
                ROW_NUMBER() OVER (PARTITION BY i.sku_id ORDER BY f.data_compra DESC, i.id DESC) AS rn
           FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id JOIN sku_normalizado s ON s.id=i.sku_id
          WHERE i.sku_id IN (${ph}) AND i.is_non_product=0 AND i.is_clearance=0
       ) t WHERE rn = 1`, ids);
    const precoPorSku = new Map(prec.map((r) => [r.sku_id, r]));
    const variantes = matched
      .map((s) => {
        const h = habito.get(s.id);
        if (!h) return null; // só o que a casa já comprou
        const p = precoPorSku.get(s.id);
        return {
          sku_id: s.id, nome: s.nome_canonico, idas: h.idas,
          qtd_habitual: Math.max(1, Math.round(h.soma / h.idas)),
          preco: p ? num(p.ppb ?? p.pu) : null,
          unidade: p?.ppb != null ? p.unidade : null,
          loja: p?.loja || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.idas - a.idas)
      .slice(0, 8);
    res.json({ variantes });
  } catch (e) {
    console.error('[lista/variantes] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar variantes' });
  }
});

// Lista atual (ativos + riscados) com preços + GRUPO, e as lojas p/ o seletor.
listaRouter.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const mercado = String(req.query.mercado || '').trim() || null;
    const [itens] = await pool.query(
      `SELECT id, nome, quantidade, categoria, estado, adicionado_por, marcado_por
         FROM lista_item WHERE estado IN ('ativo','carrinho') ORDER BY criado_em, id`,
    );
    await resolverItensLista(pool, itens, mercado);
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
    if ('nome' in (req.body || {})) {
      // concretizar o item (ex.: escolher a variante "Iogurte Grego Natural")
      const n = String(req.body.nome || '').trim().slice(0, 160);
      if (n) { sets.push('nome = ?'); vals.push(n); }
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

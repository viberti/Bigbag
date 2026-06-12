// Lista de compras PARTILHADA da família. Fonte de verdade no servidor (MySQL);
// os clientes sincronizam por polling curto enquanto a folha está aberta e fazem
// updates otimistas. Cada item guarda quem o adicionou e quem o riscou (cor do
// membro na UI). Preços: melhor preço unitário das ÚLTIMAS 3 compras do produto
// (e onde), + último preço no mercado selecionado (?mercado=) quando existe.
import { Router } from 'express';
import { createHash } from 'crypto';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';
import { grupoDeTexto, grupoDeNome, tokenCasa, singularizar, chaveItemLista, norm, tipoConsumidor, TIPOS_NOME } from '../normaliza/categoria.js';
import { classificarPorCatalogo } from '../normaliza/classificarCatalogo.js';
import { marcaDeterministica } from '../normaliza/marca.js';
import { pesoPelaImagem, versaoPesoImg } from '../ingest/pesoImagem.js';
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';

export const listaRouter = Router();
listaRouter.use(requireAuth);

const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
// norm vem de normaliza/categoria.js (unificação 2026-06-13)

// Unidade de VENDA de um item da lista (como se compra de facto, não "à unidade"):
// ovos vendem-se à dúzia, não 1 a 1. Devolve o rótulo singular (o frontend
// pluraliza) ou null (= contagem simples). Determinístico; extensível por caso.
function unidadeVenda(nome) {
  const n = norm(nome);
  // SÓ quando o produto É ovos (palavra-CABEÇA, início do nome) — não "Massa com
  // Ovo", "Doce de Ovos", "Pão de Ovo", onde o ovo é ingrediente. Ovos → dúzia.
  if (/^ovos?\b/.test(n)) return 'dúzia';
  return null;
}

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
    (singularizar(head).startsWith(singularizar(q[0])) ? fortes : fracos).push(s);
  }
  return fortes.length ? fortes : fracos;
}

// A tabela sku_normalizado é lida inteira a cada resolução de lista e a cada
// /variantes. É pequena e muda raramente (só na ingestão) → cache de 30s evita
// reler dezenas de vezes durante o polling aberto. (Date.now é permitido no
// runtime normal; só os scripts de Workflow é que o proíbem.)
let _skuCache = null, _skuCacheAt = 0;
async function carregarSkus(pool) {
  const agora = Date.now();
  if (_skuCache && agora - _skuCacheAt < 30000) return _skuCache;
  const [skus] = await pool.query('SELECT id, nome_canonico, nome_simplificado, grupo FROM sku_normalizado');
  _skuCache = skus; _skuCacheAt = agora;
  return skus;
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
  const skus = await carregarSkus(pool);
  const skuIdsPorItem = new Map();   // lista_id → Set(sku_id)
  const allSkuIds = new Set();
  for (const it of itens) {
    const matched = skusDoNome(it.nome, skus);
    skuIdsPorItem.set(it.id, new Set(matched.map((s) => s.id)));
    for (const s of matched) allSkuIds.add(s.id);
    // GRUPO (ponto 3): do SKU casado (1.º com grupo definido); senão do NOME.
    it.grupo = matched.find((s) => s.grupo && s.grupo !== 'outros')?.grupo || grupoDeTexto(it.nome);
    it.melhor_preco = null; it.melhor_loja = null; it.preco_mercado = null; it.unidade_base = null;
    it.preco_ref = null; it.preco_ref_loja = null; // referência de catálogo (sem talão)
    it.tamanho = null; // peso/volume da embalagem (linha de baixo, antes do preço)
    it.produto_sugerido = null; it.variantes_n = 0; it.qtd_habitual = null;
    it.unidade_venda = unidadeVenda(it.nome);
    // MARCA detetada no nome (gazetteer determinístico) → o cliente mostra-a à
    // parte, noutra cor (formato do talão: nome sem marca + marca destacada).
    it.marca = (await marcaDeterministica(pool, it.nome).catch(() => null))?.marca || null;
  }
  await aplicarDadosEan(pool, itens); // preço-ref + marca da ficha (corre haja ou não SKU casado)
  await aplicarCatalogoLista(pool, itens); // voto do catálogo: cat_exib (folha p/ seção) + grupo-fallback
  await aplicarTamanhoPorNome(pool, itens); // peso em falta → match por nome no catálogo
  await aplicarPrecoPorIrmao(pool, itens); // sem preço? estima pelo €/kg do IRMÃO (mesma marca/família)
  // ainda sem peso? → ferramenta "peso pela imagem" EM FUNDO (VLM lê a foto do
  // catálogo/OFF, 1x por EAN, ~$0,001). Não bloqueia; o poll seguinte traz o peso.
  for (const it of itens) {
    if (!it.tamanho && it.ean) pesoPelaImagem(it.ean); // fire-and-forget (dedup interno)
  }
  if (!allSkuIds.size) return;
  const ids = [...allSkuIds];
  const ph = ids.map(() => '?').join(',');
  // últimas 3 compras (por SKU) — para cada item escolhemos o melhor entre os seus SKUs.
  // PREÇO = preco_por_base (€/L, €/kg, €/un): comparável entre tamanhos de embalagem.
  // preco_liquido/quantidade dava o preço POR UNIDADE DO PACK (9 mini-garrafas de
  // 200ml a 0,31 contaminavam o mínimo do "leite"). Quando não há ppb (peso não
  // extraído, ex.: Farinha) cai para preco_unitario/quantidade (preço POR EMBALAGEM:
// a coluna preco_unitario guarda o VALOR DA LINHA por desenho do reconcile — nome
// enganador; com qtd>1, 11 pães a €0,15 apareciam como €1,65. Achado 2026-06-13,
// talão Makro. Correção de fundo (semântica da coluna) anotada p/ sessão de ingestão.
  const [rows] = await pool.query(
    `SELECT sku_id, ppb, pu, unidade, loja, data FROM (
       SELECT i.sku_id, i.preco_por_base AS ppb, i.preco_unitario/GREATEST(i.quantidade,1) AS pu, s.unidade_base AS unidade, COALESCE(l.cadeia,l.nome) AS loja,
              f.data_compra AS data, ROW_NUMBER() OVER (PARTITION BY i.sku_id ORDER BY f.data_compra DESC, i.id DESC) AS rn
         FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id JOIN sku_normalizado s ON s.id=i.sku_id
        WHERE i.sku_id IN (${ph}) AND i.is_non_product=0 AND i.is_clearance=0 AND (i.preco_por_base IS NOT NULL OR i.preco_unitario IS NOT NULL)
     ) t WHERE t.rn <= 3`, ids);
  // preço no mercado selecionado (a compra mais recente nesse mercado), por SKU
  let noMercado = new Map();
  if (mercado) {
    const [mrows] = await pool.query(
      `SELECT sku_id, ppb, pu, unidade FROM (
         SELECT i.sku_id, i.preco_por_base AS ppb, i.preco_unitario/GREATEST(i.quantidade,1) AS pu, s.unidade_base AS unidade,
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

// Dados por EAN (itens scaneados): (1) PREÇO DE REFERÊNCIA do catálogo — MENOR
// preço de embalagem entre lojas, aproximação (catálogo nunca é critério, só
// referência); (2) MARCA AUTORITATIVA da ficha (produto_ean) — vence a deteção
// pelo nome, que falha quando a marca não está escrita no nome (caso Rummo: nome
// "Penne Rigate" sem marca, mas a ficha tem marca=Rummo). Corre haja ou não SKU.
async function aplicarDadosEan(pool, itens) {
  const eans = [...new Set(itens.filter((it) => it.ean).map((it) => it.ean))];
  if (!eans.length) return;
  const ph = eans.map(() => '?').join(',');
  const [refs] = await pool.query(
    `SELECT ean, MIN(preco) AS preco, SUBSTRING_INDEX(GROUP_CONCAT(fonte ORDER BY preco ASC), ',', 1) AS fonte
       FROM catalogo_produto WHERE ean IN (${ph}) AND preco IS NOT NULL AND preco > 0 GROUP BY ean`, eans);
  const precoPorEan = new Map(refs.map((r) => [String(r.ean), r]));
  // GRUPO pela CATEGORIA DE LOJA (revisão 3.1, 2026-06-13): quando o nome não
  // classifica ('outros'), o categoria_path do catálogo resolve — as hierarquias
  // das lojas cobrem 78–95% dos paths PT via grupoDeTexto (vocabulário inclui ES).
  const [paths] = await pool.query(
    `SELECT ean, MAX(COALESCE(NULLIF(categoria_path,''), categoria)) AS path, MAX(NULLIF(marca,'')) AS marca
       FROM catalogo_produto WHERE ean IN (${ph}) GROUP BY ean`, eans);
  const pathPorEan = new Map(paths.map((r) => [String(r.ean), r.path]));
  const marcaCatPorEan = new Map(paths.map((r) => [String(r.ean), r.marca]));
  const [pe] = await pool.query(
    `SELECT ean, MAX(NULLIF(marca,'')) AS marca, MAX(NULLIF(quantidade,'')) AS quantidade FROM produto_ean WHERE ean IN (${ph}) GROUP BY ean`, eans);
  const pePorEan = new Map(pe.map((r) => [String(r.ean), r]));
  // formato do catálogo SÓ se for tamanho real (exclui "Nun" = parse de peso falhado)
  const [cf] = await pool.query(
    `SELECT ean, MAX(formato) AS formato FROM catalogo_produto WHERE ean IN (${ph}) AND formato IS NOT NULL AND formato NOT REGEXP '^[0-9]+ ?un$' GROUP BY ean`, eans);
  const fmtPorEan = new Map(cf.map((r) => [String(r.ean), r.formato]));
  for (const it of itens) {
    if (!it.ean) continue;
    const r = precoPorEan.get(String(it.ean));
    if (r) { it.preco_ref = num(r.preco); it.preco_ref_loja = r.fonte || null; }
    const fe = pePorEan.get(String(it.ean));
    // MARCA: catálogo > ficha > deteção no nome (caso Felicia 2026-06-13: o OFF
    // marca produtos de terceiros vendidos na Mercadona como "Hacendado"; o
    // catálogo da loja é curado e tem a forma limpa — mesma regra do nome PT-first).
    const mc = marcaCatPorEan.get(String(it.ean));
    if (mc) it.marca = mc;
    else if (fe?.marca) it.marca = fe.marca;
    it.tamanho = limparTamanho(fe?.quantidade) || limparTamanho(fmtPorEan.get(String(it.ean)));
    if ((!it.grupo || it.grupo === 'outros') && pathPorEan.get(String(it.ean))) {
      const gPath = grupoDeTexto(pathPorEan.get(String(it.ean)));
      if (gPath !== 'outros') it.grupo = gPath; // categoria de loja resolve o que o nome não resolveu
    }
  }
}

// CLASSIFICAÇÃO POR CATÁLOGO na lista (2026-06-13). Para CADA item, o voto do
// catálogo (linhas diretas por EAN; senão vizinhos por nome) dá:
//  - cat_exib: a FOLHA do caminho ("Chá Preto", "Polpa Tomate") — REGRA DO DONO:
//    a seção do usuário é a ÚLTIMA subcategoria, senão metade do catálogo cai
//    em "Mercearia". Só com voto fiável e não-estrangeiro; sem voto, o cliente
//    cai nos tipos à mão (massa/pão/…) e por fim no grupo.
//  - grupo: fallback quando o nome deixou o item em 'outros'.
// Cache por nome|ean: o catálogo muda devagar e o poll é de 3s.
const _gvCache = new Map();
async function aplicarCatalogoLista(pool, itens) {
  for (const it of itens) {
    if (!it.nome) continue;
    const k = `${norm(it.nome)}|${it.ean || ''}`;
    if (!_gvCache.has(k)) {
      if (_gvCache.size > 500) _gvCache.clear();
      let v = null;
      try {
        const r = await classificarPorCatalogo(pool, { nome: it.nome, ean: it.ean || null });
        if (r?.fiavel) v = { folha: r.es ? null : r.folha, grupo: r.grupo !== 'outros' ? r.grupo : null };
      } catch { /* catálogo indisponível → segue sem voto */ }
      _gvCache.set(k, v);
    }
    const v = _gvCache.get(k);
    if (!v) continue;
    if (v.folha) it.cat_exib = v.folha;
    if ((!it.grupo || it.grupo === 'outros') && v.grupo) it.grupo = v.grupo;
  }
}

// Número PT (sem casas inúteis, vírgula decimal): 250→"250", 1.5→"1,5".
function fmtNum(n) {
  const r = Math.round(n * 1000) / 1000;
  return (Number.isInteger(r) ? String(r) : String(r)).replace('.', ',');
}
// Formata um valor+unidade na ESCALA certa (regra do dono): peso <1000g em g,
// ≥1000g em kg; volume <1000ml em ml, ≥1000ml em L.
function fmtTamanho(v, unidade) {
  const u = unidade.toLowerCase();
  if (u === 'kg' || u === 'g' || u === 'gr' || u === 'mg') {
    const g = u === 'kg' ? v * 1000 : u === 'mg' ? v / 1000 : v;
    return g >= 1000 ? `${fmtNum(g / 1000)} kg` : `${fmtNum(g)} g`;
  }
  const ml = u === 'l' ? v * 1000 : u === 'cl' ? v * 10 : v;
  return ml >= 1000 ? `${fmtNum(ml / 1000)} L` : `${fmtNum(ml)} ml`;
}
// Tokens-CONTEÚDO de um nome (sem marca, genéricos e tamanhos) — base do match
// entre lojas por nome (mesmo produto, EAN/fonte diferente).
const STOP_TAM = new Set(['massa', 'massas', 'pasta', 'de', 'do', 'da', 'dos', 'das', 'com', 'e', 'em', 'para']);
function tokensConteudo(nome, marca) {
  const m = new Set(norm(marca || '').split(' ').filter(Boolean));
  return new Set(norm(nome).replace(/[^a-z0-9 ]/g, ' ').split(' ')
    .filter((t) => t && !STOP_TAM.has(t) && !m.has(t) && !/\d/.test(t)));
}
// Preenche o TAMANHO por NOME quando o EAN não o deu: o MESMO produto existe no
// catálogo sob outro EAN/fonte, com o peso (ex.: Cannelloni Delverde 250g). Match
// estrito por marca + conjunto-de-tokens-conteúdo; escolhe a linha com peso real
// (ignora "1un"). Determinístico, sem falsos positivos (penne ≠ penne s/glúten).
async function aplicarTamanhoPorNome(pool, itens) {
  const alvos = itens.filter((it) => !it.tamanho && it.marca);
  if (!alvos.length) return;
  const marcas = [...new Set(alvos.map((it) => it.marca))];
  const ph = marcas.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT marca, nome, formato FROM catalogo_produto WHERE marca IN (${ph}) AND formato IS NOT NULL`, marcas);
  const porMarca = new Map();
  for (const r of rows) (porMarca.get(r.marca) || porMarca.set(r.marca, []).get(r.marca)).push(r);
  for (const it of alvos) {
    const refC = tokensConteudo(it.nome, it.marca);
    if (!refC.size) continue;
    for (const r of porMarca.get(it.marca) || []) {
      const c = tokensConteudo(r.nome, it.marca);
      if (c.size === refC.size && [...c].every((x) => refC.has(x))) {
        const t = limparTamanho(r.formato);
        if (t) { it.tamanho = t; break; }
      }
    }
  }
}

// PREÇO ESTIMADO pelo IRMÃO (compromisso do dono, 2026-06-13 — caso Passata
// Mutti 700g, órfã de catálogo, mas o Auchan tem a de 400g): sem preço por EAN,
// procura no catálogo um irmão da MESMA MARCA e MESMA FAMÍLIA (tipoConsumidor
// saliente) cujos tokens DISTINTIVOS do nosso nome (fora os genéricos da família,
// ex.: "manjericão") ele contenha; estima = MENOR €/base compatível × nosso peso.
// SEMPRE rotulado "estimado" (preco_ref_tipo) — é aproximação assumida, nunca facto.
async function aplicarPrecoPorIrmao(pool, itens) {
  const alvos = itens.filter((it) => it.preco_ref == null && it.melhor_preco == null && it.marca && it.tamanho);
  if (!alvos.length) return;
  for (const it of alvos) {
    const tipo = tipoConsumidor(it.grupo, it.nome, it.marca);
    if (!['massa', 'pao', 'cereais', 'conservas', 'tomate'].includes(tipo)) continue; // famílias com semântica clara
    // peso do item em kg/L (do tamanho já normalizado: "700 g" / "1,5 kg" / "330 ml")
    const m = String(it.tamanho).replace(',', '.').match(/^([\d.]+)\s*(kg|g|l|ml)$/i);
    if (!m) continue;
    const v = parseFloat(m[1]); const u = m[2].toLowerCase();
    const pesoBase = u === 'kg' || u === 'l' ? v : v / 1000;
    // distintivos: tokens do nosso nome fora da marca e fora dos termos da família
    const reFam = (TIPOS_NOME_MAP[tipo] || null);
    const marcaToks = new Set(norm(it.marca).split(' '));
    const dist = norm(it.nome).split(' ').filter((t) => t.length >= 4 && !marcaToks.has(t) && !(reFam && reFam.test(' ' + t)) && !['tomate', 'fresco', 'fresca'].includes(t));
    const [cands] = await pool.query(
      `SELECT nome, fonte, preco_por_base, unidade_base FROM catalogo_produto
        WHERE marca = ? AND preco_por_base IS NOT NULL AND preco_por_base > 0 AND unidade_base IN ('kg','l')`, [it.marca]);
    let melhor = null;
    for (const c of cands) {
      if (tipoConsumidor(null, c.nome, it.marca) !== tipo) continue;          // mesma família
      const ct = norm(c.nome);
      if (!dist.every((t) => ct.includes(t))) continue;                        // distintivos presentes
      const ppb = Number(c.preco_por_base);
      if (!melhor || ppb < melhor.ppb) melhor = { ppb, fonte: c.fonte, nome: c.nome };
    }
    if (melhor) {
      it.preco_ref = Math.round(melhor.ppb * pesoBase * 100) / 100;
      it.preco_ref_loja = melhor.fonte;
      it.preco_ref_tipo = 'estimado'; // o cliente rotula diferente do "online"
    }
  }
}
const TIPOS_NOME_MAP = Object.fromEntries(TIPOS_NOME.map(([id, re]) => [id, re]));

// Tamanho legível e NORMALIZADO para a linha do item: extrai o peso/volume do
// texto da ficha e mostra na escala certa ("0.25kg" → "250 g", "500 g" → "500 g",
// "1500 g" → "1,5 kg"). Multipack mantém a estrutura ("4 x 125 g"). null para
// contagens puras ("1un") e quando não há padrão de tamanho.
function limparTamanho(q) {
  if (!q) return null;
  const s = String(q).trim().replace(/\s+/g, ' ').replace(',', '.');
  if (/^\d+\s*un[d]?\.?$/i.test(s)) return null;
  const multi = s.match(/(\d+)\s*x\s*([\d.]+)\s*(kg|g|gr|mg|ml|cl|l)\b/i);
  if (multi) return `${multi[1]} x ${fmtTamanho(parseFloat(multi[2]), multi[3])}`;
  const m = s.match(/([\d.]+)\s*(kg|g|gr|mg|ml|cl|l)\b/i);
  if (!m) return null;
  return fmtTamanho(parseFloat(m[1]), m[2]);
}

// Variantes HABITUAIS de um item da lista ("iogurte" → os iogurtes que ESTA casa
// compra, por frequência, com preço e loja) — o utilizador escolhe e o item
// concretiza-se (PATCH nome). Determinístico: histórico + matching por tokens.
listaRouter.get('/variantes', async (req, res) => {
  try {
    const nome = String(req.query.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'nome em falta' });
    const pool = getPool();
    const skus = await carregarSkus(pool);
    const matched = skusDoNome(nome, skus);
    if (!matched.length) return res.json({ variantes: [] });
    const ids = matched.map((s) => s.id);
    const ph = ids.map(() => '?').join(',');
    const habito = await habitosDosSkus(pool, ids);
    // preço mais recente por SKU (€/base quando há; senão preço de embalagem)
    const [prec] = await pool.query(
      `SELECT sku_id, ppb, pu, unidade, loja FROM (
         SELECT i.sku_id, i.preco_por_base AS ppb, i.preco_unitario/GREATEST(i.quantidade,1) AS pu, s.unidade_base AS unidade,
                COALESCE(l.cadeia,l.nome) AS loja,
                ROW_NUMBER() OVER (PARTITION BY i.sku_id ORDER BY f.data_compra DESC, i.id DESC) AS rn
           FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id JOIN sku_normalizado s ON s.id=i.sku_id
          WHERE i.sku_id IN (${ph}) AND i.is_non_product=0 AND i.is_clearance=0
       ) t WHERE rn = 1`, ids);
    const precoPorSku = new Map(prec.map((r) => [r.sku_id, r]));
    // foto de catálogo por SKU (via EAN das compras desse SKU) — escolher com os
    // olhos. COLLATE: item.ean (0900_ai_ci) vs catalogo (unicode_ci) não comparam
    // diretamente; força a colação do lado do item.
    const [imgs] = await pool.query(
      `SELECT i.sku_id, MAX(c.imagem_url) AS img
         FROM item i JOIN catalogo_produto c
           ON (c.ean = i.ean COLLATE utf8mb4_unicode_ci OR c.ean_inferido = i.ean COLLATE utf8mb4_unicode_ci)
        WHERE i.sku_id IN (${ph}) AND i.ean IS NOT NULL AND c.imagem_url IS NOT NULL AND c.imagem_url <> ''
        GROUP BY i.sku_id`, ids);
    const imgPorSku = new Map(imgs.map((r) => [r.sku_id, r.img]));
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
          imagem: imgPorSku.get(s.id) || null,
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

// REFEIÇÕES POSSÍVEIS — a única chamada LLM da lista ("com isto fazes Carbonara,
// falta o queijo ralado"). Cache em memória por HASH da lista (chaves ordenadas):
// a mesma lista nunca paga duas vezes; mudou um item → recalcula. Gate: ≥4 itens
// alimentares. O LLM devolve no máx. 3 refeições quase-completas (falta ≤2).
const _refeicoesCache = new Map(); // hash → [{nome, usa, falta}]
listaRouter.get('/refeicoes', async (req, res) => {
  try {
    const pool = getPool();
    const [ativos] = await pool.query("SELECT nome FROM lista_item WHERE estado IN ('ativo','carrinho')");
    const nomes = ativos.map((a) => a.nome).filter((n) => grupoDeNome(n) !== 'higiene');
    if (nomes.length < 4) return res.json({ refeicoes: [] });
    const hash = nomes.map(chaveItemLista).sort().join('|');
    if (_refeicoesCache.has(hash)) return res.json({ refeicoes: _refeicoesCache.get(hash), cacheada: true });
    const r = await chatCompletion({
      messages: [{ role: 'user', content:
        `Lista de compras de um supermercado em Portugal: ${nomes.join('; ')}.
Que refeições COMPLETAS ou QUASE completas dá para cozinhar com estes itens (+ básicos de despensa: sal, azeite, alho, cebola)?
Devolve SÓ JSON: {"refeicoes":[{"nome":"...","usa":["..."],"falta":["..."]}]}.
Regras: máximo 3 refeições; só onde a lista cobre ≥3 ingredientes PRINCIPAIS; "falta" com no máximo 2 itens (vazio se não falta nada); nomes de refeição curtos e apetitosos em português do Brasil; "usa" só com itens DA LISTA. Se nada fizer sentido, {"refeicoes":[]}.` }],
      model: config.openrouter.modelConsulta,
      responseFormat: { type: 'json_object' },
      timeoutMs: 15000,
      contexto: 'lista-refeicoes',
    });
    let refeicoes = [];
    try { refeicoes = (JSON.parse(r || '{}').refeicoes || []).slice(0, 3)
      .map((x) => ({ nome: String(x.nome || '').slice(0, 60), usa: (x.usa || []).slice(0, 8).map(String), falta: (x.falta || []).slice(0, 2).map(String) }))
      .filter((x) => x.nome); } catch { refeicoes = []; }
    if (_refeicoesCache.size > 50) _refeicoesCache.clear(); // cap simples
    _refeicoesCache.set(hash, refeicoes);
    res.json({ refeicoes });
  } catch (e) {
    console.error('[lista/refeicoes] erro:', e.message);
    res.status(500).json({ erro: 'Falha a sugerir refeições' });
  }
});

// SUGESTÕES POR CADÊNCIA — "provavelmente está a acabar" (determinístico, zero
// LLM): para cada SKU com ≥3 compras em datas distintas, intervalo MEDIANO entre
// compras vs dias desde a última. urgência ≥0.85 → sugerir, com a qtd habitual.
// Alimenta o estado vazio ("✨ Começar por mim") e o cartão no topo da lista.
async function sugestoesCadencia(pool) {
  const [rows] = await pool.query(`
    SELECT s.id, COALESCE(s.nome_simplificado, s.nome_canonico) AS nome,
           GROUP_CONCAT(DISTINCT DATE(f.data_compra) ORDER BY DATE(f.data_compra)) AS datas
      FROM item i
      JOIN fatura f ON f.id = i.fatura_id
      JOIN sku_normalizado s ON s.id = i.sku_id
     WHERE i.is_non_product = 0
     GROUP BY s.id
    HAVING COUNT(DISTINCT DATE(f.data_compra)) >= 3`);
  const hoje = Date.now();
  const cands = [];
  for (const r of rows) {
    const ds = String(r.datas || '').split(',').map((d) => new Date(d).getTime()).filter(Boolean).sort((a, b) => a - b);
    if (ds.length < 3) continue;
    const gaps = [];
    for (let i = 1; i < ds.length; i++) gaps.push((ds[i] - ds[i - 1]) / 86400000);
    gaps.sort((a, b) => a - b);
    const mediana = gaps[Math.floor(gaps.length / 2)];
    if (mediana < 2 || mediana > 90) continue; // cadência sem significado
    const diasDesde = (hoje - ds[ds.length - 1]) / 86400000;
    const urgencia = diasDesde / mediana;
    // janela 0.85–3×: abaixo ainda não falta; ACIMA de 3× o sinal inverte-se —
    // não é "esqueceu 4 vezes", é HÁBITO ABANDONADO (pão 205d/ritmo 36d ≠ falta).
    if (urgencia >= 0.85 && urgencia <= 3) cands.push({ sku_id: r.id, nome: r.nome, dias: Math.round(diasDesde), intervalo: Math.round(mediana), urgencia });
  }
  cands.sort((a, b) => b.urgencia - a.urgencia);
  const top = cands.slice(0, 12);
  if (top.length) {
    // quantidade habitual (unidades por ida) dos candidatos
    const habito = await habitosDosSkus(pool, top.map((c) => c.sku_id));
    for (const c of top) {
      const h = habito.get(c.sku_id);
      c.quantidade = h ? Math.max(1, Math.round(h.soma / h.idas)) : 1;
    }
    // não sugerir o que JÁ está na lista (consolidação pela mesma chave)
    const [ativos] = await pool.query("SELECT nome FROM lista_item WHERE estado IN ('ativo','carrinho')");
    const chavesAtivas = new Set(ativos.map((a) => chaveItemLista(a.nome)));
    return top.filter((c) => !chavesAtivas.has(chaveItemLista(c.nome)))
      .map(({ urgencia, sku_id, ...resto }) => resto);
  }
  return [];
}

listaRouter.get('/sugestoes', async (req, res) => {
  try {
    res.json({ sugestoes: await sugestoesCadencia(getPool()) });
  } catch (e) {
    console.error('[lista/sugestoes] erro:', e.message);
    res.status(500).json({ erro: 'Falha a calcular sugestões' });
  }
});

// Monta a lista completa (itens enriquecidos + lojas) — partilhado pelo GET e
// pelo POST /lote (que devolve a lista atualizada num só round-trip).
async function montarLista(pool, mercado) {
  const [itens] = await pool.query(
    `SELECT id, nome, ean, quantidade, categoria, estado, adicionado_por, marcado_por
       FROM lista_item WHERE estado IN ('ativo','carrinho') ORDER BY criado_em, id`,
  );
  await resolverItensLista(pool, itens, mercado);
  const [lojas] = await pool.query(
    `SELECT DISTINCT COALESCE(l.cadeia, l.nome) AS loja FROM fatura f JOIN loja l ON l.id = f.loja_id ORDER BY 1`,
  );
  return { itens, lojas: lojas.map((x) => x.loja).filter(Boolean), mercado };
}

// Assinatura barata do estado visível da lista — muda quando muda um item
// (nome/qtd/estado/quem riscou), o mercado selecionado, ou quando entra uma
// compra nova (maxItemId: invalida os preços). É a base do 304.
// Versão do RESOLVER: incrementar quando o cálculo derivado (preço/marca/tamanho)
// muda de lógica — senão clientes com ETag antigo ficam em 304 sem ver o novo output.
const RESOLVER_V = 5; // 5: cat_exib = folha do catálogo como seção (regra do dono); 4: chá→mercearia + nome>OFF; 3: grupo por vizinhança
function listaSig(itens, mercado, maxItemId) {
  const s = `${mercado || ''}|${maxItemId || 0}|p${versaoPesoImg()}|r${RESOLVER_V}|` +
    itens.map((i) => `${i.id}:${i.quantidade}:${i.estado}:${i.marcado_por || ''}:${i.ean || ''}:${i.nome}`).join(';');
  return createHash('sha1').update(s).digest('base64').slice(0, 22);
}

// Lista atual (ativos + riscados) com preços + GRUPO, e as lojas p/ o seletor.
// Polling aberto bate aqui de 3 em 3s: a parte cara é resolverItensLista (lê
// preços/hábitos de todos os SKUs). Com ETag, quando nada mudou devolvemos 304
// e saltamos o resolver — só corre a query leve dos itens + MAX(id). Corta ~90%
// do trabalho durante o tempo em que a lista está parada.
listaRouter.get('/', async (req, res) => {
  try {
    const mercado = String(req.query.mercado || '').trim() || null;
    const pool = getPool();
    const [itens] = await pool.query(
      `SELECT id, nome, ean, quantidade, categoria, estado, adicionado_por, marcado_por
         FROM lista_item WHERE estado IN ('ativo','carrinho') ORDER BY criado_em, id`,
    );
    const [[mx]] = await pool.query('SELECT MAX(id) AS m FROM item');
    const etag = `"${listaSig(itens, mercado, mx?.m)}"`;
    res.set('Cache-Control', 'no-cache');
    res.set('ETag', etag);
    if ((req.headers['if-none-match'] || '') === etag) return res.status(304).end();
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

// Nome de item válido? Guarda contra lixo programático: o caso real foi um
// cliente PWA em cache antiga a stringificar objetos → item "[object Object]".
const nomeValido = (n) => n && n.length >= 2 && !/\[object|^undefined$|^null$/i.test(n);

// Adiciona com CONSOLIDAÇÃO por chave normalizada (minúsculas, sem acentos,
// singular): "ovos" e "Ovo", "Bananas" e "banana" são o MESMO item → SOMA a
// quantidade em vez de duplicar (decisão do dono). Um item já riscado volta a
// ativo (nova necessidade). Partilhado pelo POST unitário e pelo /lote.
async function adicionarConsolidado(pool, { nome, quantidade, categoria, ean, user }) {
  const qtd = Math.max(1, Math.min(99, Number(quantidade) || 1));
  const cod = String(ean || '').replace(/\D/g, '') || null;
  const chave = chaveItemLista(nome);
  const [ativos] = await pool.query(
    `SELECT id, nome, quantidade, estado FROM lista_item WHERE estado IN ('ativo','carrinho')`);
  const ja = ativos.find((x) => chaveItemLista(x.nome) === chave);
  if (ja) {
    // consolida; se o item ainda não tinha EAN e este scan trouxe um, fixa-o.
    await pool.query(
      `UPDATE lista_item SET quantidade = LEAST(99, quantidade + ?), estado = 'ativo', marcado_por = NULL, ean = COALESCE(ean, ?) WHERE id = ?`,
      [qtd, cod, ja.id]);
    return { id: ja.id, consolidado: true };
  }
  const [r] = await pool.query(
    'INSERT INTO lista_item (nome, ean, quantidade, categoria, adicionado_por) VALUES (?,?,?,?,?)',
    [nome, cod, qtd, categoria || null, user]);
  return { id: r.insertId, consolidado: false };
}

listaRouter.post('/', async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim().slice(0, 160);
    if (!nomeValido(nome)) return res.status(400).json({ erro: 'nome inválido' });
    const categoria = String(req.body?.categoria || '').trim().slice(0, 80) || null;
    const r = await adicionarConsolidado(getPool(), { nome, quantidade: req.body?.quantidade, categoria, ean: req.body?.ean, user: req.user.id });
    res.json({ ok: true, id: r.id, existia: r.consolidado, consolidado: r.consolidado });
  } catch (e) {
    console.error('[lista POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a adicionar' });
  }
});

// LOTE (ditado por voz): adiciona N itens consolidados num só round-trip e
// devolve a LISTA COMPLETA atualizada + o resumo do que entrou (para a barra
// de confirmação editável da voz). Substitui N POSTs + N reloads.
listaRouter.post('/lote', async (req, res) => {
  try {
    const pool = getPool();
    const pedidos = Array.isArray(req.body?.produtos) ? req.body.produtos.slice(0, 20) : [];
    const adicionados = [];
    for (const p of pedidos) {
      const nome = String(p?.nome || '').trim().slice(0, 160);
      if (!nomeValido(nome)) continue;
      const r = await adicionarConsolidado(pool, { nome, quantidade: p?.quantidade, categoria: null, ean: p?.ean, user: req.user.id });
      adicionados.push({ id: r.id, nome, quantidade: Math.max(1, Math.min(99, Number(p?.quantidade) || 1)), consolidado: r.consolidado });
    }
    const mercado = String(req.body?.mercado || '').trim() || null;
    res.json({ ...(await montarLista(pool, mercado)), adicionados });
  } catch (e) {
    console.error('[lista/lote] erro:', e.message);
    res.status(500).json({ erro: 'Falha a adicionar os itens' });
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
    if ('inc' in (req.body || {})) {
      // DELTA em vez de valor absoluto: dois membros a carregar "+" ao mesmo
      // tempo somam os dois incrementos (valor absoluto era last-write-wins).
      const inc = Math.max(-98, Math.min(98, Number(req.body.inc) || 0));
      if (inc) { sets.push('quantidade = LEAST(99, GREATEST(1, quantidade + ?))'); vals.push(inc); }
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

// Esvaziar a lista (tudo → removido). Devolve o snapshot {id, estado} do que
// foi limpo para o "Desfazer" poder repor exatamente (incl. quem estava no
// carrinho vs ativo).
listaRouter.post('/limpar', async (req, res) => {
  try {
    const pool = getPool();
    const [limpos] = await pool.query("SELECT id, estado FROM lista_item WHERE estado IN ('ativo','carrinho')");
    await pool.query("UPDATE lista_item SET estado = 'removido' WHERE estado IN ('ativo','carrinho')");
    res.json({ ok: true, limpos });
  } catch (e) {
    console.error('[lista/limpar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a limpar' });
  }
});

// Desfazer o esvaziar: repõe o estado anterior dos itens recém-removidos. Só
// toca em quem ainda está 'removido' (se já voltou à lista por outra via, não
// duplica). Janela de uso: o snackbar de Desfazer (poucos segundos).
listaRouter.post('/restaurar', async (req, res) => {
  try {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens.slice(0, 200) : [];
    const pool = getPool();
    let restaurados = 0;
    for (const it of itens) {
      const id = Number(it?.id);
      if (!id) continue;
      const estado = it?.estado === 'carrinho' ? 'carrinho' : 'ativo';
      const [r] = await pool.query("UPDATE lista_item SET estado = ? WHERE id = ? AND estado = 'removido'", [estado, id]);
      restaurados += r.affectedRows;
    }
    res.json({ ok: true, restaurados });
  } catch (e) {
    console.error('[lista/restaurar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a restaurar' });
  }
});

// Resolve um item de talão (nome abreviado) → produto real (EAN + nutrição),
// juntando candidatos do CATÁLOGO local (Auchan/Continente, com EAN por nome PT)
// e do OPEN FOOD FACTS (por nome, traz marcas-próprias + nutrição). Pontua por
// tokens/marca/formato e, opcionalmente, confirma com um JUIZ LLM (distingue
// variantes: caixa vs barras, culinário vs leite — onde o token-overlap falha).
import { chatCompletion } from '../openrouter.js';
import { extrairFormato } from './formato.js';
import { nomesPorEan } from './mestreEan.js';

const STOP = new Set(['de','da','do','e','com','sem','para','por','kg','kgs','g','gr','grs','ml','cl','lt','l','un','und','unid','sabor','tipo','pack','x','the','of']);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t.length >= 3 && !STOP.has(t));

// RARIDADE (IDF): cada palavra pesa pela sua raridade no catálogo. "mel" aparece em
// centenas de produtos → pesa pouco; "rosmaninho" em poucos → pesa muito. Carrega
// uma vez (cache no processo); a partir daí o match dá importância às palavras que
// DISTINGUEM, não às da categoria que todos partilham.
let _idf = null;
async function carregarIdf(pool) {
  if (_idf) return _idf;
  const [rows] = await pool.query("SELECT nome FROM catalogo_produto WHERE nome IS NOT NULL AND nome <> ''");
  const df = new Map();
  for (const r of rows) for (const t of new Set(toks(r.nome))) df.set(t, (df.get(t) || 0) + 1);
  const N = rows.length || 1;
  const w = new Map();
  for (const [t, d] of df) w.set(t, Math.log((N + 1) / (d + 1)));
  _idf = { w, max: Math.log(N + 1) }; // palavra nunca vista → tão rara quanto possível
  return _idf;
}
const peso = (idf, t) => (idf ? (idf.w.get(t) ?? idf.max) : 1);

// Formatos compatíveis? (ex.: 330g vs 6x25g → incompatível). null = desconhecido (não penaliza).
function formatoCompativel(a, b) {
  const fa = extrairFormato(a), fb = extrairFormato(b);
  if (!fa || !fb || fa.formato_valor == null || fb.formato_valor == null) return null;
  if (fa.unidade_base !== fb.unidade_base) return false;
  const r = fa.formato_valor / fb.formato_valor;
  return r > 0.8 && r < 1.25; // ±25%
}

// PORTA de marca: a marca do candidato (catálogo) tem de aparecer no item do talão.
// Exige TODOS os tokens da marca presentes (evita falsos como "Pingo Doce" a casar
// só por "doce"). Sem marca no candidato, ou marca ausente no item → não confirma.
// É o que separa o Caso 2 (marca nacional, mesmo GTIN) do Caso 1 (marca-própria).
function marcaBate(item, marcaCand) {
  const bm = toks(marcaCand);
  if (!bm.length) return false;
  const hay = new Set(toks(`${item.descricao} ${item.marca || ''}`));
  return bm.every((t) => hay.has(t));
}

// PORTA do produto: tirando os tokens da MARCA dos dois lados, o que define a comida
// (o substantivo: requeijão, mel, presunto) tem de bater. Sem isto, a marca/região
// sozinha deixa passar "requeijão Serra Estrela" → "ÁGUA Serra Estrela". Devolve a
// fração de tokens não-marca do talão que aparecem no candidato (0..1).
function produtoOverlap(item, nomeCand, marcaCand, idf) {
  const brand = new Set(toks(marcaCand));
  const itemNB = [...new Set(toks(item.descricao))].filter((t) => !brand.has(t));
  if (!itemNB.length) return 0;
  const candNB = new Set(toks(nomeCand).filter((t) => !brand.has(t)));
  // fração do PESO (raridade) dos tokens do talão que o candidato cobre. Partilhar só
  // "mel" (comum) vale pouco; falhar "rosmaninho" (raro) deixa a fração bem abaixo de 0,5.
  let num = 0, den = 0;
  for (const t of itemNB) { const w = peso(idf, t); den += w; if (candNB.has(t)) num += w; }
  return den ? num / den : 0;
}

// PORTA de preço (FILTRO DE DISPARATE, não desempate fino): preço é cross-loja/data e
// o €/base varia com a embalagem, por isso NÃO se usa para escolher entre vizinhos a
// cêntimos (isso promovia a variante errada). Serve só para matar o GROSSEIRAMENTE
// fora — >5× num sentido = quase de certeza outro produto (ex.: requeijão €1,51 vs
// queijo €16,69). Margem larga p/ tolerar diferença de loja/promo/tamanho e unidades.
function precoDisparate(itemPpb, candPpb) {
  if (!itemPpb || !candPpb) return false; // sem preço → não filtra
  const r = itemPpb / candPpb;
  return r > 5 || r < 0.2;
}

function pontuar(item, cand, idf) {
  const qi = toks(`${item.descricao} ${item.marca || ''}`);
  const tc = new Set(toks(`${cand.nome} ${cand.marca || ''}`));
  if (!qi.length) return 0;
  // sobreposição ponderada pela raridade (palavras distintivas mandam na pontuação).
  let num = 0, den = 0;
  for (const t of qi) { const w = peso(idf, t); den += w; if (tc.has(t)) num += w; }
  let score = den ? num / den : 0;
  // bónus de marca
  if (item.marca && tc.has(norm(item.marca).split(' ')[0])) score += 0.15;
  // formato
  const fc = formatoCompativel(item.descricao, cand.nome);
  if (fc === false) score -= 0.35; // formato incompatível → forte penalização
  if (fc === true) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

// ── Candidatos do catálogo local (só com EAN) ──────────────────────────────
// opts: { limite, fonte: filtra a uma fonte do catálogo (ex.: 'continente'),
//         portaMarca: exige a marca do candidato no talão (default true — desligar
//         no match MESMA-LOJA, onde a marca é implícita e o "CNT" não bate "Continente") }
export async function candidatosCatalogo(pool, item, opts = {}) {
  const { limite = 12, fonte: fonteFiltro = null, portaMarca = true } = opts;
  const idf = await carregarIdf(pool);
  const q = [...new Set(toks(`${item.descricao} ${item.marca || ''}`))];
  if (!q.length) return [];
  // 1) Gera EANs candidatos: procura pelos tokens MAIS RAROS (não os mais longos) —
  // é "rosmaninho"/"frosties" que traz os candidatos certos, não "mel"/"cereais".
  const chave = q.sort((a, b) => peso(idf, b) - peso(idf, a)).slice(0, 4);
  const meta = new Map(); // ean → { marca, categoria_path, fontes:Set, ppb }
  for (const tok of chave) {
    const [rows] = await pool.query(
      `SELECT ean, marca, categoria_path, fonte, preco_por_base FROM catalogo_produto
         WHERE ean IS NOT NULL AND ean <> '' AND nome LIKE ?${fonteFiltro ? ' AND fonte = ?' : ''} LIMIT 40`,
      fonteFiltro ? [`%${tok}%`, fonteFiltro] : [`%${tok}%`]);
    for (const r of rows) {
      if (!meta.has(r.ean)) meta.set(r.ean, { marca: r.marca, categoria_path: r.categoria_path, fontes: new Set(), ppb: r.preco_por_base });
      const m = meta.get(r.ean);
      m.fontes.add(r.fonte);
      if (!m.marca && r.marca) m.marca = r.marca;
      if (r.preco_por_base != null && (m.ppb == null || r.preco_por_base < m.ppb)) m.ppb = r.preco_por_base;
    }
  }
  if (!meta.size) return [];
  // 2) Mestre por EAN: busca TODAS as variantes de nome (Auchan+Continente+ident) de
  // cada EAN e pontua contra a MELHOR variante → a tese (match contra todas as fontes).
  const nomes = await nomesPorEan(pool, [...meta.keys()]);
  return [...meta.entries()].map(([ean, m]) => {
    // PORTA: a marca do candidato tem de aparecer no talão — senão não arriscamos
    // (é o que evita o "BIO MILHO DOCE" → Bonduelle). Desligável no match mesma-loja.
    if (portaMarca && !marcaBate(item, m.marca)) return null;
    const variantes = [...(nomes.get(ean) || [])];
    let melhor = variantes[0] || '', best = 0;
    for (const n of variantes) { const s = pontuar(item, { nome: n, marca: m.marca }, idf); if (s > best) { best = s; melhor = n; } }
    // PORTA do produto: o substantivo distintivo (sem a marca) tem de bater em ≥50%
    // do PESO — mata "requeijão→água", "mel rosmaninho→mel laranjeira", variantes erradas.
    if (produtoOverlap(item, melhor, m.marca, idf) < 0.5) return null;
    // PORTA de preço: mata disparates (>5× fora) — ex.: "REQUEIJÃO €1,51/kg" → "QUEIJO
    // Serra Estrela €16,69/kg". Não desempata fino (isso erra a variante).
    if (precoDisparate(item.preco_por_base, m.ppb)) return null;
    // EANs com prefixo "2" são códigos INTERNOS de loja (peso variável) — não são
    // GTINs reais nem têm nutrição no OFF; despriorizar para o GTIN real ganhar.
    const score = /^2/.test(ean) ? best * 0.6 : best;
    const fonte = [...m.fontes].join('+');
    return { ean, nome: melhor, nomes: variantes, marca: m.marca, categoria_path: m.categoria_path, preco_por_base: m.ppb, fonte, origem: fonte, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limite);
}

// ── Candidatos do Open Food Facts (por nome) ───────────────────────────────
export async function candidatosOFF(item, limite = 8) {
  // termos limpos: tira tokens com dígitos (formato: 330g, 18, 36) e limita a 5
  const termos = toks(`${item.marca || ''} ${item.descricao}`).filter((t) => !/\d/.test(t)).slice(0, 5).join(' ');
  if (!termos) return [];
  try {
    const u = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(termos)}&search_simple=1&action=process&json=1&page_size=${limite}&fields=code,product_name,brands,quantity,nutriscore_grade,nova_group`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(u, { headers: { 'User-Agent': 'Bigbag/0.1 (laboratorio pessoal)' }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.products || [])
      .filter((p) => p.code && p.product_name)
      .map((p) => ({ ean: String(p.code), nome: p.product_name, marca: p.brands || null, origem: 'off', score: pontuar(item, { nome: p.product_name, marca: p.brands }) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limite);
  } catch {
    return [];
  }
}

// ── Juiz LLM: qual candidato é O MESMO produto (ou nenhum)? ─────────────────
async function juiz(item, candidatos) {
  const lista = candidatos.map((c, i) => `${i + 1}. ${c.nome}${c.marca ? ` (${c.marca})` : ''} [EAN ${c.ean}]`).join('\n');
  const messages = [
    { role: 'system', content: 'És um normalizador de produtos de supermercado português. Dada a descrição ABREVIADA de um item de talão e uma lista de candidatos, escolhe o que é EXATAMENTE o mesmo produto (mesma variante, sabor e formato). Se nenhum corresponde com confiança, devolve indice null. Distingue variantes (ex.: caixa de cereais ≠ barras; culinário ≠ leite; 330g ≠ 6x25g). Responde só JSON: {"indice": n|null, "confianca": 0..1, "motivo": "curto"}.' },
    { role: 'user', content: `ITEM DO TALÃO: "${item.descricao}"${item.marca ? ` | marca: ${item.marca}` : ''}\n\nCANDIDATOS:\n${lista}` },
  ];
  try {
    const txt = await chatCompletion({ messages, responseFormat: { type: 'json_object' }, contexto: 'match_produto' });
    const j = JSON.parse(txt);
    const idx = Number.isInteger(j.indice) ? j.indice - 1 : null;
    if (idx == null || idx < 0 || idx >= candidatos.length) return { escolha: null, confianca: 0, motivo: j.motivo };
    return { escolha: candidatos[idx], confianca: Number(j.confianca) || 0, motivo: j.motivo };
  } catch {
    return { escolha: null, confianca: 0, motivo: 'erro juiz' };
  }
}

// ── Orquestrador ───────────────────────────────────────────────────────────
// item: { descricao, marca? }. Devolve { ean, nome, marca, origem, confianca, via } ou null.
export async function resolverProduto(pool, item, { usarLLM = true } = {}) {
  const [cat, off] = await Promise.all([candidatosCatalogo(pool, item), candidatosOFF(item)]);
  const todos = [...cat, ...off].filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  if (!todos.length) return null;

  // Sem LLM: só aceita o topo se a pontuação for forte (token+marca+formato).
  if (!usarLLM) { const top = todos[0]; return top.score >= 0.6 ? { ...top, confianca: top.score, via: 'pontuacao' } : null; }

  // Com LLM: SEMPRE confirma com o juiz (evita falsos positivos de nomes genéricos
  // como "creme de limpeza" → Cif). O juiz distingue variantes e rejeita não-matches.
  const { escolha, confianca, motivo } = await juiz(item, todos.slice(0, 8));
  if (!escolha) return null;
  return { ...escolha, confianca, motivo, via: 'llm' };
}

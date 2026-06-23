// ADAPTADOR VTEX — colhe o catálogo de QUALQUER loja na plataforma VTEX (dominante no
// retalho BR: Carrefour, Pão de Açúcar, regionais). Um adaptador serve todas. Alimenta
// AS DUAS camadas: IDENTIDADE (EAN+nome+marca+categoria+imagem) e PREÇO+LOCALE (preço R$).
//
// FOOTPRINT (como reconhecer/achar uma loja VTEX):
//   - caminho da API:  /api/catalog_system/pub/products/search   (no Google: inurl:catalog_system/pub)
//   - CDN de assets:   vtexassets.com / vteximg.com.br
//   - URL de produto:  termina em /p
//   - TESTE infalível: GET https://<host>/api/catalog_system/pub/products/search?_from=0&_to=0
//     devolve um array JSON  ->  é VTEX. (modo --detect abaixo faz isto a uma lista.)
//
// API usada (pública, sem token):
//   - árvore de categorias:  /api/catalog_system/pub/category/tree/50
//   - busca paginada:        /api/catalog_system/pub/products/search?fq=C:<catId>&_from=N&_to=N+49
//     (50 por pedido; offset topo ~2500 -> paginamos POR CATEGORIA-FOLHA para varrer tudo).
//
// Corre NO SERVIDOR (alcança a API + tem BD). Idempotente: DELETE fonte=<x> + INSERT.
//
// Uso:
//   sudo -u dev node --env-file=.env scripts/harvest_vtex.mjs <host> [fonte]
//   sudo -u dev node --env-file=.env scripts/harvest_vtex.mjs --detect host1,host2,host3
import { getPool, closePool } from '../src/db.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';
import { tituloProduto } from '../src/normaliza/titulo.js';
import { aplicarProxy } from '../src/rede.js';
import { precoValido } from '../src/normaliza/precoValido.js';

const UA = 'Mozilla/5.0 (compatible; BigBag-catalog-probe/1.0)';
const DELAY = Number(process.env.DELAY || 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const eanOk = (s) => {
  s = String(s || ''); if (!/^\d{13}$/.test(s)) return false; if (s[0] === '2') return false;
  const d = s.split('').map(Number); const c = d.pop(); let su = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) su += d[i] * w;
  return (10 - (su % 10)) % 10 === c;
};
async function getJson(u, ms = 20000) {
  for (let t = 0; ; t++) {
    let r;
    try { r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(ms) }); }
    catch (e) { if (t >= 3) throw e; await sleep(1000 * (t + 1)); continue; }
    if ((r.status === 429 || r.status === 503) && t < 5) { await sleep(1500 * (t + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status);
    const txt = await r.text(); try { return JSON.parse(txt); } catch { return null; }
  }
}

// --detect: testa uma lista de hosts contra o endpoint VTEX.
async function detectar(hosts) {
  for (const h of hosts) {
    const host = h.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim(); if (!host) continue;
    let vtex = false, n = null;
    try { const a = await getJson(`https://${host}/api/catalog_system/pub/products/search?_from=0&_to=0`, 12000); vtex = Array.isArray(a); }
    catch { /* nao-VTEX ou bloqueado */ }
    if (vtex) { try { const c = await getJson(`https://${host}/api/catalog_system/pub/category/tree/1`, 12000); n = Array.isArray(c) ? c.length : null; } catch {} }
    console.log(`  ${vtex ? 'VTEX ' : '  -  '} ${host}${vtex && n != null ? `  (${n} categorias de topo)` : ''}`);
    await sleep(300);
  }
}

const flattenCats = (tree, out = []) => { for (const c of tree || []) { out.push(c.id); if (c.hasChildren && c.children) flattenCats(c.children, out); } return out; };
// ids a varrer: se rootIds dado, só as SUBÁRVORES dessas categorias-raiz (p/ marketplaces enormes
// onde só interessam alguns ramos — ex.: Americanas, varrer só Alimentos/Higiene/Limpeza). Senão, tudo.
function catsParaVarrer(tree, rootIds) {
  if (!rootIds || !rootIds.size) return [...new Set(flattenCats(tree))];
  const out = [];
  const walk = (nodes, dentro) => { for (const c of nodes || []) { const hit = dentro || rootIds.has(c.id); if (hit) out.push(c.id); if (c.hasChildren && c.children) walk(c.children, hit); } };
  walk(tree, false);
  return [...new Set(out)];
}
const niveis = (path) => String(path || '').split('/').map((s) => s.trim()).filter(Boolean);

async function harvest(host, fonte, rootIds, deep = false) {
  const pool = getPool();
  console.log(`[vtex:${fonte}] árvore de categorias…`);
  const tree = await getJson(`https://${host}/api/catalog_system/pub/category/tree/50`);
  const cats = catsParaVarrer(tree, rootIds);
  console.log(`[vtex:${fonte}] ${cats.length} categorias${rootIds && rootIds.size ? ` (âmbito: raízes ${[...rootIds].join(',')})` : ' (árvore toda)'}${deep ? ' · modo FUNDO (sub-paginação por preço)' : ''}. A varrer (delay ${DELAY}ms)…`);

  const prods = new Map(); // productId -> produto (dedup entre categorias/faixas)
  let topo = 0;
  // Pagina UMA query (filtros fq) até ao teto de 2500 do VTEX. Devolve se truncou.
  async function paginar(fqs) {
    const q = fqs.map((f) => `fq=${f}`).join('&').replace(/ /g, '%20');
    let truncou = false;
    for (let from = 0; from <= 2450; from += 50) {
      let arr; try { arr = await getJson(`https://${host}/api/catalog_system/pub/products/search?${q}&_from=${from}&_to=${from + 49}`); } catch { break; }
      await sleep(DELAY);
      if (!Array.isArray(arr) || !arr.length) break;
      for (const p of arr) if (!prods.has(p.productId)) prods.set(p.productId, p);
      if (from === 2450 && arr.length === 50) truncou = true; // encheu as 2500 → há mais
      if (arr.length < 50) break;
    }
    return truncou;
  }
  // Modo FUNDO: o offset do VTEX bate num teto de 2500; quebra-o por FAIXAS DE PREÇO,
  // partindo ao meio (recursivo) qualquer faixa que ainda sature. O dedup por
  // productId trata as sobreposições nas fronteiras. Resolve cats com >2500 produtos.
  async function varrerPreco(cat, lo, hi, prof = 0) {
    const truncou = await paginar([`C:${cat}`, `P:[${lo} TO ${hi}]`]);
    if (truncou && hi - lo > 0.5 && prof < 24) {
      const mid = Math.round(((lo + hi) / 2) * 100) / 100;
      await varrerPreco(cat, lo, mid, prof + 1);
      await varrerPreco(cat, mid, hi, prof + 1);
    }
  }
  for (const cat of cats) {
    if (deep) await varrerPreco(cat, 0, 100000);
    else if (await paginar([`C:${cat}`])) topo++;
  }
  if (!deep && topo) console.log(`[vtex:${fonte}] AVISO: ${topo} categorias no teto de 2500 (corre com --fundo p/ sub-paginar por preço).`);
  if (deep) console.log(`[vtex:${fonte}] modo FUNDO: ${prods.size} produtos após sub-paginação por preço.`);

  // montar linhas: 1 por (produto, item-com-EAN)
  const vals = []; const vistos = new Set(); let comEan = 0, comImg = 0;
  for (const p of prods.values()) {
    const path = (p.categories || [])[0] || '';
    const nv = niveis(path).map((s) => tituloProduto(s));
    const marca = p.brand ? tituloProduto(String(p.brand).slice(0, 140)) : null;
    const nome = tituloProduto(String(p.productName || '').slice(0, 255));
    const url = (p.link || (p.linkText ? `https://${host}/${p.linkText}/p` : `https://${host}`)).slice(0, 600);
    for (const it of (p.items || [])) {
      const ean = it.ean; if (!eanOk(ean)) continue;
      const sku = String(it.itemId || `${p.productId}`).slice(0, 24);
      if (vistos.has(sku)) continue; vistos.add(sku); comEan++;
      const img = (it.images && it.images[0] && it.images[0].imageUrl) ? String(it.images[0].imageUrl).slice(0, 600) : null;
      if (img) comImg++;
      // GUARD na fonte (Cluster 1): descarta sentinela/centavo/esgotado → preco=null (mantém
      // a IDENTIDADE; o histórico só loga preço válido; não regrava lixo amanhã).
      const co = (it.sellers || [])[0]?.commertialOffer || {};
      const dispOk = !((num(co.AvailableQuantity) != null && num(co.AvailableQuantity) <= 0) || co.IsAvailable === false);
      const preco = precoValido(num(co.Price), { disponivel: dispOk }) ? num(co.Price) : null;
      const fmt = extrairFormato(nome);
      const ppb = preco != null && fmt ? precoPorBase({ preco_liquido: preco, quantidade: 1 }, fmt) : null;
      vals.push([fonte, sku, ean, nome, marca,
        path ? path.replace(/^\/|\/$/g, '') : null, nv[nv.length - 1] || null, nv[0] || null, nv[1] || null, nv[2] || null, nv[3] || null,
        fmt ? (`${fmt.formato_valor ?? ''}${fmt.unidade_base ?? ''}`.trim() || null) : null, fmt?.unidade_base || null, fmt?.formato_valor ?? null,
        preco, 'BRL', ppb, url, img]);
    }
  }
  console.log(`[vtex:${fonte}] produtos:${prods.size} | linhas c/ EAN:${comEan} (${comImg} c/ imagem). A gravar…`);
  // GUARD: 0 linhas = host bloqueado/mudou → NÃO apagar os dados bons (o DELETE+INSERT só
  // substitui quando a colheita trouxe algo). Crítico no cron (re-colheitas automáticas).
  if (!vals.length) { console.log(`⚠️ [vtex:${fonte}] 0 linhas c/ EAN — ABORTADO, dados existentes MANTIDOS (host bloqueado/mudou?).`); await closePool(); return; }
  // preços atuais p/ detetar MUDANÇA (histórico só quando o preço muda ou é sku novo).
  const [cur] = await pool.query('SELECT sku_fonte, preco FROM catalogo_produto WHERE fonte = ?', [fonte]);
  const precoAtual = new Map(cur.map((r) => [r.sku_fonte, r.preco == null ? null : Number(r.preco)]));
  const hist = []; // índices em `vals`: sku=1, ean=2, preco=14, moeda=15, ppb=16
  for (const v of vals) {
    const preco = v[14]; if (preco == null) continue;
    const ant = precoAtual.has(v[1]) ? precoAtual.get(v[1]) : undefined;
    if (ant === undefined || ant === null || Number(ant) !== Number(preco)) hist.push([fonte, v[1], v[2], preco, v[15], v[16]]);
  }
  // UPSERT — NUNCA apaga. Novos entram; existentes atualizam os campos do CATÁLOGO (nome/marca/
  // categoria/imagem/url/preço) + scraped_at. Os campos ENRIQUECIDOS (nutrição, product_type,
  // nome_pt, vetor_em…) NÃO estão no INSERT → são PRESERVADOS. Produtos que saíram da loja ficam.
  for (let i = 0; i < vals.length; i += 500) {
    await pool.query(
      `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, categoria_path, categoria, cat_n1, cat_n2, cat_n3, cat_n4,
         formato, unidade_base, formato_valor, preco, moeda, preco_por_base, url, imagem_url, scraped_at)
       VALUES ` + vals.slice(i, i + 500).map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())').join(',') +
      ` ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca),
         categoria_path=VALUES(categoria_path), categoria=VALUES(categoria), cat_n1=VALUES(cat_n1),
         cat_n2=VALUES(cat_n2), cat_n3=VALUES(cat_n3), cat_n4=VALUES(cat_n4), formato=VALUES(formato),
         unidade_base=VALUES(unidade_base), formato_valor=VALUES(formato_valor), preco=VALUES(preco),
         moeda=VALUES(moeda), preco_por_base=VALUES(preco_por_base), url=VALUES(url),
         imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
      vals.slice(i, i + 500).flat(),
    );
  }
  // histórico de preço (append-only): só as mudanças/novos (o anterior não se perde).
  for (let i = 0; i < hist.length; i += 500) {
    await pool.query(
      `INSERT INTO catalogo_preco_hist (fonte, sku_fonte, ean, preco, moeda, preco_por_base, visto_em)
       VALUES ` + hist.slice(i, i + 500).map(() => '(?,?,?,?,?,?,NOW())').join(','),
      hist.slice(i, i + 500).flat(),
    );
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(DISTINCT ean) eans FROM catalogo_produto WHERE fonte = ?', [fonte]);
  console.log(`✅ [vtex:${fonte}] catálogo: ${c.n} linhas | ${c.eans} EANs | preços mudados/novos: +${hist.length} no histórico.`);
  await closePool();
}

async function main() {
  const args = process.argv.slice(2);
  const a = args[0];
  if (!a) { console.log('uso: harvest_vtex.mjs <host> [fonte] [--cats=id1,id2,…] [--fundo] [--proxy]  |  --detect host1,host2,… [--proxy]'); process.exit(1); }
  if (args.includes('--proxy')) aplicarProxy(); // fontes geo-bloqueadas (ex.: DPSP) → saída BR
  if (a === '--detect') { await detectar((args[1] || '').split(',')); process.exit(0); }
  const catsArg = args.find((x) => x.startsWith('--cats='));
  const rootIds = catsArg ? new Set(catsArg.slice(7).split(',').map(Number).filter(Boolean)) : null;
  const deep = args.includes('--fundo'); // quebra o teto de 2500 sub-paginando por preço
  const host = a.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const fonte = (args.slice(1).find((x) => !x.startsWith('--')) || host.replace(/^www\./, '').split('.')[0]).slice(0, 16);
  await harvest(host, fonte, rootIds, deep);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

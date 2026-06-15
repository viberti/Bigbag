// HARVESTER de fontes .pt — lojas PrestaShop que põem o EAN no URL do produto.
// Descobre produtos por crawl de categorias + paginação, colhe EAN + nome + URL do produto
// e insere em catalogo_produto com fonte='harvest' (a loja identifica-se pelo `url`). Preenche
// sobretudo o GAP dos NÃO-ALIMENTARES (limpeza/higiene/casa), que o OFF (food-focused) não cobre.
//
// PoC validada (merceariaexpresso, 2026-06-15): 211 págs → 696 EANs, 238 (34%) novos.
//
// Idempotente: re-correr SUBSTITUI os dados dessa loja (DELETE por fonte+host + INSERT). Educado:
// User-Agent claro, 200ms entre pedidos, cap de páginas. NÃO entra nas FONTES_PT do fichaEan
// (logo o nome passa pela tradução/título como qualquer fonte não-confiável). product_type fica
// por preencher → correr scripts/backfill_product_type.mjs a seguir. categoria fica null (a
// classificação faz-se pelo NOME, via fusor de família).
//
// Uso:  sudo -u dev node --env-file=.env scripts/harvest_lojas_pt.mjs [loja]
//   sem argumento → corre TODAS as lojas de SHOPS.
import { getPool, closePool } from '../src/db.js';

// Lojas PrestaShop confirmadas (EAN no slug do URL: …-<13 dígitos>.html).
const SHOPS = {
  merceariaexpresso: { base: 'https://merceariaexpresso.pt' },
  ibersuper:         { base: 'https://ibersuper.pt' },
  comuniti:          { base: 'https://comuniti.pt' },
  granjadecister:    { base: 'https://granjadecister.pt' },
  humbertomarques:   { base: 'https://humbertomarques.pt' },
};
const FONTE = 'harvest';

const UA = 'Mozilla/5.0 (compatible; BigBag-catalog-probe/1.0)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eanValido = (s) => {
  s = String(s); if (s.length !== 13) return false;
  const d = s.split('').map(Number); const c = d.pop(); let sum = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w;
  return (10 - (sum % 10)) % 10 === c;
};
async function get(u) {
  const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

// Crawl BFS das categorias (segue subcategorias + paginação ?page=N). Colhe os produtos das
// listagens: o EAN está no href (…-<13>.html) e o nome no title do mesmo <a>.
async function crawl(base, { maxPaginas = 800, delayMs = 200 } = {}) {
  const host = new URL(base).host;
  const abs = (u) => (u.startsWith('http') ? u : base + (u.startsWith('/') ? u : '/' + u));
  const isProd = (u) => /-(\d{13})\.html/.test(u);
  const isCat = (u) => u.includes(host) && !isProd(u) && /\/\d+-[a-z0-9-]+/i.test(u)
    && !/\.(jpg|jpeg|png|gif|webp|css|js|pdf|xml)(\?|$)/i.test(u);
  const prods = new Map();
  const enq = new Set([base]); const frontier = [base]; let fetches = 0;
  while (frontier.length && fetches < maxPaginas) {
    const u = frontier.shift();
    let h; try { h = await get(u); fetches++; } catch { continue; }
    await sleep(delayMs);
    // produtos: cada <a ... href="…-EAN.html" ... title="Nome">
    for (const m of h.matchAll(/<a\b[^>]*?href="([^"]*?-(\d{13})\.html)"[^>]*>/gi)) {
      const ean = m[2]; if (!eanValido(ean)) continue;
      const nome = (m[0].match(/\btitle="([^"]+)"/i) || [])[1]?.trim() || null;
      const url = abs(m[1].split('?')[0]);
      const ex = prods.get(ean);
      if (!ex) prods.set(ean, { nome, url });
      else if (!ex.nome && nome) ex.nome = nome;
    }
    // categorias a seguir
    for (const m of h.matchAll(/href="([^"#]+)"/g)) {
      let href = m[1]; if (href.startsWith('/')) href = base + href; if (!href.startsWith('http')) continue;
      const clean = href.split('?')[0].split('#')[0];
      if (isCat(clean) && !enq.has(clean)) { enq.add(clean); frontier.push(clean); }
    }
    // paginação
    const pages = [...h.matchAll(/[?&]page=(\d+)/g)].map((m) => +m[1]);
    const maxP = Math.min(Math.max(0, ...pages), 60); const baseU = u.split('?')[0];
    if (!/[?&]page=/.test(u)) for (let p = 2; p <= maxP; p++) { const pu = baseU + '?page=' + p; if (!enq.has(pu)) { enq.add(pu); frontier.push(pu); } }
  }
  return { prods, fetches };
}

const pool = getPool();
const alvo = process.argv[2];
const lojas = alvo ? (SHOPS[alvo] ? { [alvo]: SHOPS[alvo] } : {}) : SHOPS;
if (!Object.keys(lojas).length) { console.log('Loja desconhecida. Disponíveis:', Object.keys(SHOPS).join(', ')); await closePool(); process.exit(1); }
let totNovos = 0;
for (const [nome, cfg] of Object.entries(lojas)) {
  console.log(`\n== ${nome} (${cfg.base}) ==`);
  let prods, fetches;
  try { ({ prods, fetches } = await crawl(cfg.base)); }
  catch (e) { console.log('  crawl falhou:', e.message); continue; }
  const arr = [...prods.keys()];
  console.log(`  páginas: ${fetches} | EANs válidos: ${arr.length}`);
  if (!arr.length) continue;
  const inCat = new Set();
  for (let i = 0; i < arr.length; i += 800) {
    const [r] = await pool.query('SELECT DISTINCT ean e FROM catalogo_produto WHERE ean IN (?)', [arr.slice(i, i + 800)]);
    for (const x of r) inCat.add(String(x.e));
  }
  const novos = arr.filter((e) => !inCat.has(e));
  await pool.query('DELETE FROM catalogo_produto WHERE fonte = ? AND url LIKE ?', [FONTE, cfg.base + '%']); // idempotente, por loja
  const vals = arr.map((e) => { const p = prods.get(e); return [FONTE, e, p.nome ? p.nome.slice(0, 255) : null, p.url ? p.url.slice(0, 500) : cfg.base]; });
  for (let i = 0; i < vals.length; i += 500) await pool.query('INSERT INTO catalogo_produto (fonte, ean, nome, url) VALUES ?', [vals.slice(i, i + 500)]);
  console.log(`  inseridos: ${arr.length} (fonte=${FONTE}) · NOVOS p/ o catálogo: ${novos.length} (${Math.round(novos.length / arr.length * 100)}%)`);
  totNovos += novos.length;
}
console.log(`\nTOTAL novos para o catálogo: ${totNovos}`);
await closePool();

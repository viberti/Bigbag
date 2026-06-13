// Scraper GENÉRICO de lojas com schema.org JSON-LD → catalogo_produto. Lê um
// sitemap de produtos, abre cada ficha, extrai o Product do <script ld+json>
// (gtin13=EAN, nome, marca, preço, imagem) + formato/€-base do nome. Serve
// QUALQUER loja que use o standard (é a forma de juntar a CAUDA LONGA de lojas
// pequenas e limpas). Upsert por (fonte, sku_fonte), reentrante, educado.
//   sudo -u dev node --env-file=.env scripts/scrape_jsonld.mjs --fonte=piccantino \
//     --sitemap=https://www.piccantino.es/sitemap-p.xml [--limite=0] [--host=https://www.piccantino.es]
import { getPool } from '../src/db.js';
import { eanValido } from '../src/ingest/produto.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';

const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const FONTE = arg('fonte');
const SITEMAP = arg('sitemap');
const HOST = arg('host') || (SITEMAP ? new URL(SITEMAP).origin : '');
const LIMITE = Number(arg('limite')) || 0;
const CONC = Number(arg('conc')) || 5;
if (!FONTE || !SITEMAP) { console.error('faltam --fonte e --sitemap'); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = async (url) => {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }, signal: AbortSignal.timeout(20000) }); if (r.status === 404) return null; if (r.ok) return await r.text(); } catch { /* retry */ }
    await sleep(500 * (i + 1));
  }
  return null;
};
const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

// extrai o objeto Product de TODOS os blocos ld+json (lida com @graph e arrays)
function produtoLd(html) {
  for (const blk of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let d; try { d = JSON.parse(blk[1].trim()); } catch { continue; }
    const fila = Array.isArray(d) ? [...d] : [d];
    while (fila.length) {
      const o = fila.shift();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o['@graph'])) fila.push(...o['@graph']);
      const tipo = [].concat(o['@type'] || []);
      if (tipo.includes('Product')) return o;
    }
  }
  return null;
}
const brandStr = (b) => (typeof b === 'string' ? b : (b && (b.name || b['@id'])) || '');
function offerPreco(off) {
  let o = Array.isArray(off) ? off[0] : off;
  if (!o) return [null, null];
  const p = o.price ?? o.lowPrice ?? o.highPrice ?? null;
  return [p != null ? Number(p) : null, o.priceCurrency || null];
}

const pool = getPool();
const [existRows] = await pool.query('SELECT url FROM catalogo_produto WHERE fonte = ?', [FONTE]);
const feitos = new Set(existRows.map((r) => r.url));

// recolhe URLs de produto (sitemap pode ser índice → segue sub-sitemaps .xml)
let urls = [];
const sm = await txt(SITEMAP);
for (const u of locs(sm || '')) {
  if (/\.xml($|\?)/i.test(u)) { const s2 = await txt(u); urls.push(...locs(s2 || '')); }
  else urls.push(u);
}
urls = [...new Set(urls)].filter((u) => !feitos.has(u) && !/\.xml($|\?)/i.test(u));
if (LIMITE) urls = urls.slice(0, LIMITE);
console.log(`${FONTE}: ${urls.length} fichas por raspar (${feitos.size} já feitas)`);

const COLS = 'fonte, sku_fonte, ean, nome, marca, categoria_path, categoria, cat_n1, formato, unidade_base, formato_valor, preco, preco_por_base, url, imagem_url, scraped_at';
async function gravar(rows) {
  if (!rows.length) return;
  const ph = rows.map(() => '(' + new Array(15).fill('?').join(',') + ',NOW())').join(',');
  await pool.query(
    `INSERT INTO catalogo_produto (${COLS}) VALUES ${ph}
     ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), formato=VALUES(formato),
       unidade_base=VALUES(unidade_base), formato_valor=VALUES(formato_valor), preco=VALUES(preco),
       preco_por_base=VALUES(preco_por_base), imagem_url=VALUES(imagem_url), scraped_at=NOW()`, rows.flat());
}

function rowDe(url, p) {
  const nome = String(p.name || '').slice(0, 255); if (!nome) return null;
  const ean = [].concat(p.gtin13 || p.gtin || p.gtin12 || p.gtin8 || []).map(String)[0] || '';
  const sku = String(p.sku || p.mpn || ean || url.split('/').pop()).slice(0, 24);
  const [preco] = offerPreco(p.offers);
  const fmt = extrairFormato(nome);
  const ppb = preco != null && fmt ? precoPorBase({ preco_liquido: preco, quantidade: 1 }, fmt) : null;
  const img = (Array.isArray(p.image) ? p.image[0] : p.image) || null;
  return ['', sku, eanValido(ean) ? ean : null, nome, brandStr(p.brand).slice(0, 140) || null,
    null, p.category ? String(p.category).slice(0, 140) : null, null,
    fmt ? `${fmt.formato_valor ?? ''}${fmt.unidade_base ?? ''}`.trim() || null : null,
    fmt?.unidade_base || null, fmt?.formato_valor ?? null, preco, ppb,
    url.slice(0, 600), img ? String(img).slice(0, 600) : null];
}

let total = 0, semEan = 0, falhas = 0;
const t0 = Date.now();
for (let i = 0; i < urls.length; i += CONC) {
  const lote = urls.slice(i, i + CONC);
  const rows = (await Promise.all(lote.map(async (u) => {
    const html = await txt(u); if (!html) { falhas++; return null; }
    const p = produtoLd(html); if (!p) { falhas++; return null; }
    const r = rowDe(u, p); if (r) { r[0] = FONTE; if (!r[2]) semEan++; }
    return r;
  }))).filter(Boolean);
  await gravar(rows);
  total += rows.length;
  process.stderr.write(`\r  ${total}/${urls.length} · ${semEan} sem EAN · ${falhas} falhas · ${(total / ((Date.now() - t0) / 1000)).toFixed(1)}/s   `);
  await sleep(150);
}
console.log(`\nconcluído: ${total} produtos (${total - semEan} c/ EAN), ${falhas} falhas`);
await pool.end();
process.exit(0);

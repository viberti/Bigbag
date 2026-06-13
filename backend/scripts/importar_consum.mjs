// Importa o catálogo do CONSUM (ES) → catalogo_produto (fonte='consum'). API JSON
// pública (a mesma que a loja usa). Enumera por CRAWL BFS de categorias: começa por
// termos, descobre os categoryId dos próprios produtos e percorre cada categoria
// com paginação (offset). Upsert por (fonte, sku_fonte) → reentrante. Educado
// (delay entre pedidos). O Consum dá EAN+preço+preço-por-base+marca+foto.
//   sudo -u dev node --env-file=.env scripts/importar_consum.mjs [--limite=0]
import { getPool } from '../src/db.js';
import { eanValido } from '../src/ingest/produto.js';

const BASE = 'https://tienda.consum.es/api/rest/V1.0/catalog/searcher/products';
const HOST = 'https://tienda.consum.es';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0', Accept: 'application/json', Referer: HOST + '/' };
const LIMITE = Number((process.argv.find((a) => a.startsWith('--limite=')) || '').split('=')[1]) || 0;
const SEED = ['aceite', 'leche', 'cafe', 'pasta', 'arroz', 'chocolate', 'cerveza', 'agua', 'yogur', 'galletas',
  'atun', 'tomate', 'harina', 'azucar', 'sal', 'queso', 'jamon', 'cereales', 'zumo', 'mantequilla', 'pollo',
  'refresco', 'vino', 'conserva', 'congelado', 'pan', 'fruta', 'verdura', 'detergente', 'champu', 'pañal', 'snack'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = getPool();
const get = async (qs) => {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(BASE + qs, { headers: H, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(500 * (i + 1));
  }
  return null;
};

// preço-por-base do Consum: centUnitAmount por unitPriceUnitType ("1 L","1 kg","100 g"…)
function perBase(centUnit, tipo) {
  if (centUnit == null || !tipo) return [null, null];
  const m = String(tipo).trim().toLowerCase().match(/^([\d.]+)\s*(l|kg|g|ml|cl|ud|uds|un|unidad)/);
  if (!m) return [null, null];
  const q = Number(m[1]) || 1; let u = m[2]; let v = Number(centUnit);
  if (u === 'g') { u = 'kg'; v = v * (1000 / q); } else if (u === 'ml') { u = 'l'; v = v * (1000 / q); }
  else if (u === 'cl') { u = 'l'; v = v * (100 / q); } else if (u === 'l' || u === 'kg') { v = v / q; }
  else { u = 'un'; v = v / q; }
  return [Math.round(v * 10000) / 10000, u];
}

const rowDe = (p) => {
  const pd = p.productData || {};
  const ean = String(p.ean || '');
  const cats = (p.categories || []).filter((c) => c.type === 0).map((c) => c.name).filter(Boolean);
  const preco = (() => { try { return p.priceData?.prices?.find((x) => x.id === 'PRICE')?.value?.centAmount ?? null; } catch { return null; } })();
  const centUnit = (() => { try { return p.priceData?.prices?.find((x) => x.id === 'PRICE')?.value?.centUnitAmount ?? null; } catch { return null; } })();
  const [ppb, ubase] = perBase(centUnit, p.priceData?.unitPriceUnitType);
  const fval = (preco != null && ppb) ? Math.round((preco / ppb) * 1000) / 1000 : null;
  const media = (p.media || []).find((m) => m.url)?.url || null;
  const url = pd.url ? (String(pd.url).startsWith('http') ? pd.url : HOST + pd.url) : `${HOST}/products/${p.code}`;
  return [
    'consum', String(p.code || p.id), eanValido(ean) ? ean : null, String(pd.name || '').slice(0, 255),
    String((pd.brand && (pd.brand.name || pd.brand.id)) || '').slice(0, 140) || null,
    cats.join(' / ').slice(0, 300) || null, cats[cats.length - 1]?.slice(0, 140) || null,
    cats[0]?.slice(0, 90) || null, cats[1]?.slice(0, 90) || null, cats[2]?.slice(0, 90) || null,
    fval && ubase ? `${fval} ${ubase}` : null, ubase, fval, preco, ppb,
    url.slice(0, 600), media?.slice(0, 600) || null,
  ];
};

const COLS = 'fonte, sku_fonte, ean, nome, marca, categoria_path, categoria, cat_n1, cat_n2, cat_n3, formato, unidade_base, formato_valor, preco, preco_por_base, url, imagem_url, scraped_at';
async function gravar(rows) {
  if (!rows.length) return;
  const ph = rows.map(() => '(' + new Array(17).fill('?').join(',') + ',NOW())').join(',');
  await pool.query(
    `INSERT INTO catalogo_produto (${COLS}) VALUES ${ph}
     ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), categoria_path=VALUES(categoria_path),
       categoria=VALUES(categoria), cat_n1=VALUES(cat_n1), formato=VALUES(formato), unidade_base=VALUES(unidade_base),
       formato_valor=VALUES(formato_valor), preco=VALUES(preco), preco_por_base=VALUES(preco_por_base),
       imagem_url=VALUES(imagem_url), scraped_at=NOW()`, rows.flat());
}

// crawl: fila de fontes (termo ou categoria), descobre categorias pelos produtos
const filaTermo = [...SEED];
const filaCat = [];
const catVistas = new Set();
const eansVistos = new Set();
const skusVistos = new Set();
let total = 0, pedidos = 0;
const t0 = Date.now();

async function percorrer(qsBase, etiqueta) {
  let offset = 0;
  while (true) {
    if (LIMITE && total >= LIMITE) return;
    const d = await get(`${qsBase}&limit=40&offset=${offset}&showRecommendations=false`);
    pedidos++;
    const prods = d?.catalog?.products || [];
    if (!prods.length) return;
    const lote = [];
    for (const p of prods) {
      for (const c of p.categories || []) if (c.type === 0 && !catVistas.has(c.id)) { catVistas.add(c.id); filaCat.push(c.id); }
      const sku = String(p.code || p.id);
      if (skusVistos.has(sku)) continue;
      skusVistos.add(sku);
      const ean = String(p.ean || ''); if (eanValido(ean)) eansVistos.add(ean);
      lote.push(rowDe(p));
    }
    if (lote.length) { await gravar(lote); total += lote.length; }
    process.stderr.write(`\r  ${total} produtos · ${eansVistos.size} EAN · ${catVistas.size} cats · ${pedidos} req · ${etiqueta.slice(0, 18)}   `);
    if (!d?.catalog?.hasMore || offset > 2000) return;
    offset += 40;
    await sleep(250);
  }
}

for (const q of filaTermo) { if (LIMITE && total >= LIMITE) break; await percorrer(`?q=${encodeURIComponent(q)}`, 'termo:' + q); }
while (filaCat.length) { if (LIMITE && total >= LIMITE) break; const id = filaCat.shift(); await percorrer(`?q=&categoryId=${id}`, 'cat:' + id); }

console.log(`\nconcluído: ${total} produtos (${eansVistos.size} c/ EAN global), ${catVistas.size} categorias, ${pedidos} pedidos, ${Math.round((Date.now() - t0) / 1000)}s`);
await pool.end();
process.exit(0);

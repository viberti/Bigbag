// HARVESTER Supermercados Mundial (RJ, grande) — storefront Next.js + API GraphQL própria
// (Apollo) em mundial-api.supermercadosmundial.com.br. Decifrado 2026-06-17 por introspeção
// ABERTA (o WAF não bloqueia datacenter aqui). NÃO é VipCommerce/VTEX.
//
// Particularidades do GraphQL (resolver finicky):
//   - CSRF do Apollo: exige `content-type: application/json` + `apollo-require-preflight: true`.
//   - `products(where,limit,offset,order)` SÓ funciona filtrado por **group** (id string, 1021 groups);
//     `where:{category}`/`{status}`/`getTotalOfProducts` REBENTAM no servidor deles ("Falha ao executar").
//   - Campos seguros = SCALARES: sku, ean, name, customName, customBrand. Objetos (brand{}, group{}) e
//     customType/customWeight/hasImage rebentam o resolver → NÃO pedir.
//   - Sem nutrição/ingredientes no schema (só Recipe.ingredients). Preço só p/ os ~535 em oferta → ignorado.
//   - Imagem: https://mundial-api.supermercadosmundial.com.br/products/<sku>/300x300.webp
//
// Enumeração: productGroups{id} → para cada group, products(where:{group},limit,offset) paginado.
//   sudo -u dev node --env-file=.env scripts/harvest_mundial.mjs [--delay 120] [--limit 500]
import { getPool, closePool } from '../src/db.js';
import { eanValido } from '../src/normaliza/ean.js';

const FONTE = 'mundial';
const API = 'https://mundial-api.supermercadosmundial.com.br/';
const IMG = (sku) => `https://mundial-api.supermercadosmundial.com.br/products/${sku}/300x300.webp`;
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DELAY = Number(arg('--delay', '120'));
const LIMIT = Number(arg('--limit', '500'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = {
  'content-type': 'application/json', accept: 'application/json', 'apollo-require-preflight': 'true',
  origin: 'https://www.supermercadosmundial.com.br', referer: 'https://www.supermercadosmundial.com.br/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
async function gql(query) {
  for (let t = 0; ; t++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: H, body: JSON.stringify({ query }), signal: AbortSignal.timeout(25000) });
      if (r.status >= 500 && t < 4) { await sleep(1500 * (t + 1)); continue; }
      const j = await r.json().catch(() => null);
      return j;
    } catch (e) { if (t >= 4) return null; await sleep(1000 * (t + 1)); }
  }
}

async function upsert(pool, vals) {
  if (!vals.length) return;
  await pool.query(
    `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, moeda, imagem_url, scraped_at)
     VALUES ${vals.map(() => '(?,?,?,?,?,?,?,NOW())').join(',')}
     ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca),
       imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
    vals.flat(),
  );
}

async function main() {
  const pool = getPool();
  const gr = await gql('{productGroups{id}}');
  const groups = (gr?.data?.productGroups || []).map((g) => g.id);
  if (!groups.length) { console.error('sem productGroups:', JSON.stringify(gr).slice(0, 200)); process.exit(1); }
  console.log(`${FONTE}: ${groups.length} groups`);
  await pool.query('DELETE FROM catalogo_produto WHERE fonte = ?', [FONTE]); // crawl fresco
  const vistos = new Set();
  let total = 0; let comEan = 0; let gi = 0;
  for (const g of groups) {
    gi++;
    for (let offset = 0; ; offset += LIMIT) {
      const q = `{products(where:{group:"${g}"},limit:${LIMIT},offset:${offset}){sku ean name customName customBrand}}`;
      const j = await gql(q);
      const prods = j?.data?.products;
      if (!Array.isArray(prods)) break; // erro/sem dados → próximo group
      const vals = [];
      for (const p of prods) {
        const sku = String(p.sku || ''); if (!sku || vistos.has(sku)) continue; vistos.add(sku);
        const eanCru = String(p.ean || '').replace(/\D/g, '');
        const ean = eanValido(eanCru) ? eanCru : null; if (ean) comEan++;
        const nome = String(p.customName || p.name || sku).slice(0, 255);
        const marca = (p.customBrand || '').trim() ? String(p.customBrand).slice(0, 140) : null;
        vals.push([FONTE, `mu-${sku}`.slice(0, 24), ean, nome, marca, 'BRL', IMG(sku)]);
      }
      await upsert(pool, vals);
      total += vals.length;
      if (prods.length < LIMIT) break; // última página deste group
      await sleep(DELAY);
    }
    if (gi % 50 === 0) process.stderr.write(`\r  group ${gi}/${groups.length} · ${total} produtos · ${comEan} c/ EAN   `);
    await sleep(DELAY);
  }
  process.stderr.write('\n');
  const [[c]] = await pool.query(
    'SELECT COUNT(*) n, SUM(ean IS NOT NULL) ean, SUM(imagem_url IS NOT NULL) img FROM catalogo_produto WHERE fonte = ?', [FONTE]);
  console.log(`✅ ${FONTE}: ${c.n} linhas | ${c.ean} c/ EAN | ${c.img} c/ imagem`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

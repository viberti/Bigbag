// HARVESTER Extra / extramercado.com.br (GPA) — irmão do Pão de Açúcar: MESMA API Linx, banner
// diferente. API de busca por categoria:
//   POST https://api.vendas.gpa.digital/ex/search/category-page   (path /ex/, storeId 483)
//   body: {partner:'linx', page, resultsPerPage:36, multiCategory:<slug>, sortBy:'relevance',
//          department:'ecom', storeId:483, customerPlus:true}
//   resposta: {page,totalPages,totalProducts,products:[{id,sku,name,brand,price,productImages[],urlDetails,variableWeight}]}
//
// A LISTAGEM traz nome+MARCA+preço+FOTO+url (a Extra dá `brand`, ao contrário do Pão de Açúcar) mas
// NÃO traz EAN → entra como CORPO DE IMAGENS+NOME+MARCA p/ o match (CLIP+nome). O EAN está na PDP
// (`__NEXT_DATA__` tem `ean`) e obtém-se num 2.º passo separado e RESUMÍVEL: scripts/enriquecer_extra_ean.mjs
// (gota-a-gota, à la Continente — a PDP pesa ~336 KB, inviável varrer tudo de uma vez).
//
// Corre NO SERVIDOR (alcança a API + tem BD). Idempotente: DELETE fonte='extra' + upsert. Educado (delay).
//   sudo -u dev node --env-file=.env scripts/harvest_extra.mjs [cat1,cat2,…]
import { getPool, closePool } from '../src/db.js';

const FONTE = 'extra';
const STORE = 483;
const IMG_HOST = 'https://static.extramercado.com.br'; // (static.gpa.digital dá 404; o host do banner serve as imagens)
const API = 'https://api.vendas.gpa.digital/ex/search/category-page';
const ORIGIN = 'https://www.extramercado.com.br';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CATS = (process.argv[2] || 'alimentos,bebidas,bebidas-alcoolicas,limpeza,beleza-e-perfumaria,perfumaria,descartaveis,bebe-e-crianca,bazar,petshop,textil,eletro').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null)));

async function pagina(cat, page) {
  for (let t = 0; ; t++) {
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', origin: ORIGIN, referer: `${ORIGIN}/`, 'user-agent': UA },
        body: JSON.stringify({ partner: 'linx', page, resultsPerPage: 36, multiCategory: cat, sortBy: 'relevance', department: 'ecom', storeId: STORE, customerPlus: true }),
        signal: AbortSignal.timeout(20000),
      });
      if ((r.status === 429 || r.status >= 500) && t < 4) { await sleep(1500 * (t + 1)); continue; }
      if (!r.ok) return null;
      return JSON.parse(await r.text());
    } catch (e) { if (t >= 4) return null; await sleep(1000 * (t + 1)); }
  }
}

async function upsert(pool, vals) {
  if (!vals.length) return;
  await pool.query(
    `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, categoria, preco, moeda, url, imagem_url, scraped_at)
     VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?,?,?,NOW())').join(',')}
     ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=COALESCE(VALUES(marca), marca), preco=VALUES(preco),
       moeda=VALUES(moeda), url=VALUES(url), imagem_url=VALUES(imagem_url),
       categoria=COALESCE(categoria, VALUES(categoria)), scraped_at=NOW()`,
    vals.flat(),
  );
}

async function main() {
  const pool = getPool();
  await pool.query('DELETE FROM catalogo_produto WHERE fonte = ?', [FONTE]); // idempotente
  let total = 0;
  for (const cat of CATS) {
    const p1 = await pagina(cat, 1);
    if (!p1?.products) { console.log(`  ${cat}: sem resposta`); continue; }
    const tp = Math.min(p1.totalPages || 1, 1000); // teto de segurança
    console.log(`== ${cat}: ${p1.totalProducts} produtos, ${tp} páginas ==`);
    const vistos = new Set();
    for (let pg = 1; pg <= tp; pg++) {
      const d = pg === 1 ? p1 : await pagina(cat, pg);
      if (!d?.products?.length) { if (pg > 1) await sleep(120); continue; }
      const vals = [];
      for (const x of d.products) {
        if (!x.id || vistos.has(x.id)) continue; vistos.add(x.id);
        const img = (Array.isArray(x.productImages) && x.productImages[0]) ? (IMG_HOST + x.productImages[0]).slice(0, 600) : null;
        const preco = num(typeof x.price === 'number' ? x.price : (x.price?.value ?? x.price?.currentPrice ?? null));
        const marca = (x.brand && String(x.brand).trim()) ? String(x.brand).trim().slice(0, 120) : null;
        vals.push([FONTE, `ex-${x.id}`.slice(0, 24), null, String(x.name || `ex-${x.id}`).slice(0, 255), marca, cat, preco, 'BRL', String(x.urlDetails || '').slice(0, 600) || null, img]);
      }
      await upsert(pool, vals);
      total += vals.length;
      if (pg % 25 === 0) process.stderr.write(`\r  ${cat} ${pg}/${tp} (total ${total})   `);
      await sleep(120);
    }
    process.stderr.write('\n');
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, SUM(imagem_url IS NOT NULL) img, SUM(marca IS NOT NULL) marca, SUM(preco IS NOT NULL) preco FROM catalogo_produto WHERE fonte = ?', [FONTE]);
  console.log(`✅ ${FONTE}: ${c.n} linhas | ${c.img} c/ foto | ${c.marca} c/ marca | ${c.preco} c/ preço (sem EAN — 2.º passo: enriquecer_extra_ean.mjs).`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

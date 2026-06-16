// HARVESTER Pão de Açúcar (GPA) — um dos maiores mercados BR. API de busca Linx:
//   POST https://api.vendas.gpa.digital/pa/search/category-page
//   headers: accept: application/json, content-type: application/json, origin/referer do site
//   body: {partner:'linx', page, resultsPerPage:36, multiCategory:<slug>, sortBy:'relevance',
//          department:'ecom', storeId:461, customerPlus:true}
//   resposta: {page,totalPages,totalProducts,products:[{id,sku,name,price,productImages[],urlDetails}]}
//
// A LISTAGEM NÃO TRAZ EAN (só nome+preço+FOTO+url) → entra como CORPO DE IMAGENS p/ o match
// por imagem (CLIP) + nome. O EAN obtém-se da PDP (__NEXT_DATA__ tem `ean`) num 2.º passo,
// só para os que o match não resolver. (Decisão do dono: mesmo sem EAN, a foto faz o match.)
//
// Corre no servidor (alcança a API). Idempotente (DELETE fonte + upsert). Educado (delay).
//   sudo -u dev node --env-file=.env scripts/harvest_paodeacucar.mjs [cat1,cat2,…]
import { getPool, closePool } from '../src/db.js';

const FONTE = 'paodeacucar';
const STORE = 461;
const IMG_HOST = 'https://static.paodeacucar.com';
const API = 'https://api.vendas.gpa.digital/pa/search/category-page';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CATS = (process.argv[2] || 'alimentos,bebidas,bebidas-alcoolicas,limpeza,beleza-e-perfumaria,perfumaria,descartaveis,bebe-e-crianca,bazar,petshop,textil,eletro').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pagina(cat, page) {
  for (let t = 0; ; t++) {
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', origin: 'https://www.paodeacucar.com', referer: 'https://www.paodeacucar.com/', 'user-agent': UA },
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
    `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, categoria, preco, moeda, url, imagem_url, scraped_at)
     VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?,?,NOW())').join(',')}
     ON DUPLICATE KEY UPDATE nome=VALUES(nome), preco=VALUES(preco), moeda=VALUES(moeda),
       url=VALUES(url), imagem_url=VALUES(imagem_url), categoria=COALESCE(categoria, VALUES(categoria)), scraped_at=NOW()`,
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
        const preco = typeof x.price === 'number' ? x.price : (x.price?.value ?? x.price?.currentPrice ?? null);
        vals.push([FONTE, `pa-${x.id}`.slice(0, 24), null, String(x.name || `pa-${x.id}`).slice(0, 255), cat, preco, 'BRL', String(x.urlDetails || '').slice(0, 600) || null, img]);
      }
      await upsert(pool, vals);
      total += vals.length;
      if (pg % 25 === 0) process.stderr.write(`\r  ${cat} ${pg}/${tp} (total ${total})   `);
      await sleep(120);
    }
    process.stderr.write('\n');
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, SUM(imagem_url IS NOT NULL) img, SUM(preco IS NOT NULL) preco FROM catalogo_produto WHERE fonte = ?', [FONTE]);
  console.log(`✅ ${FONTE}: ${c.n} linhas | ${c.img} c/ foto | ${c.preco} c/ preço (sem EAN — corpo p/ match por imagem).`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

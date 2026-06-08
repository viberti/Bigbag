// Scraper do catálogo Auchan PT → tabela `catalogo_auchan`.
// Fluxo robots-compliant: sitemap_index → sitemap_*-product.xml (enumera URLs,
// PERMITIDO) → abre cada ficha (PERMITIDO) → JSON-LD `Product` + categoria do
// caminho do URL → upsert. NUNCA usa /pesquisa (Disallow). Gentil: concorrência
// limitada + pausa entre pedidos; resumível (salta SKUs já no catálogo).
//
// Uso:
//   node scripts/scrape_auchan.mjs [limite]
//   AUCHAN_FILTRO=/alimentacao/ AUCHAN_POOL=4 AUCHAN_DELAY=250 AUCHAN_SO_NOVOS=1 \
//     node scripts/scrape_auchan.mjs 30
import { getPool } from '../src/db.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';

const UA = 'Mozilla/5.0 (compatible; BigbagBot/0.1; +catálogo pessoal)';
const SITEMAP_INDEX = 'https://www.auchan.pt/sitemap_index.xml';
const LIMITE = Number(process.argv[2] || process.env.AUCHAN_LIMITE || 0); // 0 = todos
const FILTRO = process.env.AUCHAN_FILTRO || '/alimentacao/';
const POOL = Number(process.env.AUCHAN_POOL || 4);
const DELAY = Number(process.env.AUCHAN_DELAY || 250);
const SO_NOVOS = process.env.AUCHAN_SO_NOVOS !== '0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function fetchText(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
const prettify = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

function categoriaDoUrl(url) {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean); // pt, <cats...>, <slug>, <id>.html
    const cats = segs.slice(1, -2); // tira 'pt', o slug do produto e o id.html
    if (!cats.length) return { path: null, leaf: null, niveis: [] };
    return { path: cats.join('/'), leaf: prettify(cats[cats.length - 1]), niveis: cats };
  } catch { return { path: null, leaf: null, niveis: [] }; }
}

function jsonLdProduct(html) {
  const blocos = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocos) {
    let j;
    try { j = JSON.parse(b); } catch { continue; }
    for (const o of Array.isArray(j) ? j : [j]) {
      const tipo = o && o['@type'];
      if (tipo === 'Product' || (Array.isArray(tipo) && tipo.includes('Product'))) return o;
    }
  }
  return null;
}

function extrairFicha(url, html) {
  const p = jsonLdProduct(html);
  if (!p) return null;
  const ean = String(p.gtin13 || p.gtin || p.gtin14 || p.gtin8 || '').replace(/\D/g, '') || null;
  const sku = String(p.sku || p.mpn || '').trim() || null;
  const nome = String(p.name || '').trim() || null;
  if (!sku || !nome) return null;
  const marca = (typeof p.brand === 'object' ? p.brand?.name : p.brand) || null;
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const preco = num(offer?.price);
  const moeda = offer?.priceCurrency || 'EUR';
  const imagem = (Array.isArray(p.image) ? p.image[0] : p.image) || null;
  const cat = categoriaDoUrl(url);
  const fmt = extrairFormato(nome);
  const ppb = preco != null && fmt ? precoPorBase({ preco_liquido: preco, quantidade: 1 }, fmt) : null;
  return {
    sku_auchan: sku, ean, nome: nome.slice(0, 255), marca: marca ? String(marca).slice(0, 140) : null,
    categoria_path: cat.path, categoria: cat.leaf, cat_n1: cat.niveis[0] || null, cat_n2: cat.niveis[1] || null,
    cat_n3: cat.niveis[2] || null, cat_n4: cat.niveis[3] || null,
    formato: fmt ? `${fmt.formato_valor ?? ''}${fmt.unidade_base ?? ''}`.trim() || null : null,
    unidade_base: fmt?.unidade_base || null, formato_valor: fmt?.formato_valor ?? null,
    preco, moeda, preco_por_base: ppb, url, imagem_url: imagem ? String(imagem).slice(0, 600) : null,
  };
}

async function upsert(pool, f) {
  await pool.query(
    `INSERT INTO catalogo_auchan
       (sku_auchan, ean, nome, marca, categoria_path, categoria, cat_n1, cat_n2, cat_n3, cat_n4,
        formato, unidade_base, formato_valor, preco, moeda, preco_por_base, url, imagem_url, scraped_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, NOW())
     ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca),
       categoria_path=VALUES(categoria_path), categoria=VALUES(categoria), cat_n1=VALUES(cat_n1),
       cat_n2=VALUES(cat_n2), cat_n3=VALUES(cat_n3), cat_n4=VALUES(cat_n4), formato=VALUES(formato),
       unidade_base=VALUES(unidade_base), formato_valor=VALUES(formato_valor), preco=VALUES(preco),
       moeda=VALUES(moeda), preco_por_base=VALUES(preco_por_base), url=VALUES(url),
       imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
    [f.sku_auchan, f.ean, f.nome, f.marca, f.categoria_path, f.categoria, f.cat_n1, f.cat_n2, f.cat_n3, f.cat_n4,
      f.formato, f.unidade_base, f.formato_valor, f.preco, f.moeda, f.preco_por_base, f.url, f.imagem_url],
  );
}

async function main() {
  const pool = getPool();
  console.log('A ler o índice de sitemaps…');
  const idx = await fetchText(SITEMAP_INDEX);
  const sitemapsProduto = locs(idx).filter((u) => /-product\.xml/i.test(u));
  console.log(`Sitemaps de produto: ${sitemapsProduto.length} (${sitemapsProduto.map((u) => u.split('/').pop()).join(', ')})`);

  let urls = [];
  for (const sm of sitemapsProduto) {
    const xml = await fetchText(sm);
    urls.push(...locs(xml));
  }
  const total = urls.length;
  urls = urls.filter((u) => u.includes(FILTRO));
  console.log(`URLs de produto: ${total} no total, ${urls.length} em "${FILTRO}".`);

  if (SO_NOVOS) {
    const [exist] = await pool.query('SELECT sku_auchan FROM catalogo_auchan');
    const has = new Set(exist.map((r) => String(r.sku_auchan)));
    const skuDoUrl = (u) => (u.match(/\/(\d+)\.html?$/)?.[1] || null);
    const antes = urls.length;
    urls = urls.filter((u) => { const s = skuDoUrl(u); return !(s && has.has(s)); });
    if (antes !== urls.length) console.log(`Resumível: ${antes - urls.length} já no catálogo, restam ${urls.length}.`);
  }
  if (LIMITE > 0) urls = urls.slice(0, LIMITE);
  console.log(`A processar ${urls.length} fichas (pool=${POOL}, delay=${DELAY}ms)…\n`);

  let ok = 0, semFicha = 0, erro = 0, feitos = 0;
  async function worker(lista) {
    for (const url of lista) {
      try {
        const html = await fetchText(url);
        if (!html) { semFicha++; }
        else {
          const f = extrairFicha(url, html);
          if (!f) { semFicha++; }
          else { await upsert(pool, f); ok++; }
        }
      } catch (e) { erro++; if (erro <= 5) console.error('  erro:', url.split('/').pop(), e.message); }
      feitos++;
      if (feitos % 25 === 0) console.log(`  …${feitos}/${urls.length} (ok ${ok}, sem-ficha ${semFicha}, erro ${erro})`);
      await sleep(DELAY);
    }
  }
  // reparte as URLs por POOL trabalhadores
  const baldes = Array.from({ length: POOL }, () => []);
  urls.forEach((u, i) => baldes[i % POOL].push(u));
  await Promise.all(baldes.map(worker));

  console.log(`\n✅ Concluído: ${ok} guardados, ${semFicha} sem JSON-LD, ${erro} erros.`);
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(ean) com_ean FROM catalogo_auchan');
  console.log(`Catálogo: ${c.n} produtos (${c.com_ean} com EAN).`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

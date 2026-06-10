// Scraper do catálogo MERCADONA → catalogo_produto (fonte 'mercadona').
// Fonte: API JSON pública da loja online ES (tienda.mercadona.es) — a Mercadona PT
// não tem loja online, mas o sortido Hacendado é o mesmo e os talões PT até
// imprimem nomes meio-ES ("PICADA VACUNO"); as facetas multilingue tratam o resto.
// Dá EAN + nome + marca + embalagem + preço + €/base (reference_price) + categorias.
// ⚠ Preços são de ESPANHA — aproximação (o bonusPreco do matching é só bónus).
//
// Uso:  node scripts/scrape_mercadona.mjs [limite]
//       SO_NOVOS=0 DELAY=500 node scripts/scrape_mercadona.mjs
import { getPool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const BASE = 'https://tienda.mercadona.es/api';
const UA = 'Mozilla/5.0 (compatible; BigbagBot/0.1; catalogo pessoal)';
const LIMITE = Number(process.argv[2] || 0);
const DELAY = Number(process.env.DELAY || 400);
const SO_NOVOS = process.env.SO_NOVOS !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

async function getJson(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; } // backoff gentil
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
  return null;
}

// size_format da API → a nossa unidade_base.
const UNIDADE = { kg: 'kg', g: 'kg', l: 'L', ml: 'L', cl: 'L', ud: 'un', u: 'un' };

async function main() {
  const pool = getPool();
  console.log('[mercadona] a enumerar categorias…');
  const raiz = await getJson(`${BASE}/categories/`);
  if (!raiz?.results) throw new Error('API de categorias indisponível');

  // nível 0 → subcategorias (nível 1); cada uma lista grupos (nível 2) com produtos
  const produtos = new Map(); // id → { n1, n2, n3 }
  for (const c0 of raiz.results) {
    for (const c1 of c0.categories || []) {
      const det = await getJson(`${BASE}/categories/${c1.id}/`);
      await sleep(DELAY);
      if (!det) continue;
      for (const c2 of det.categories || []) {
        for (const p of c2.products || []) {
          if (!produtos.has(p.id)) produtos.set(p.id, { n1: c0.name, n2: c1.name, n3: c2.name });
        }
      }
    }
  }
  console.log(`[mercadona] produtos enumerados: ${produtos.size}`);

  let ids = [...produtos.keys()];
  if (SO_NOVOS) {
    const [ex] = await pool.query("SELECT sku_fonte FROM catalogo_produto WHERE fonte='mercadona'");
    const has = new Set(ex.map((r) => String(r.sku_fonte)));
    const antes = ids.length;
    ids = ids.filter((id) => !has.has(String(id)));
    if (antes !== ids.length) console.log(`[mercadona] resumível: ${antes - ids.length} já feitos, restam ${ids.length}.`);
  }
  if (LIMITE > 0) ids = ids.slice(0, LIMITE);
  console.log(`[mercadona] a processar ${ids.length} (delay=${DELAY}ms)…\n`);

  let ok = 0, semEan = 0, erro = 0, feitos = 0;
  for (const id of ids) {
    try {
      const d = await getJson(`${BASE}/products/${id}/?lang=es`);
      if (d?.display_name) {
        const cat = produtos.get(id);
        const pi = d.price_instructions || {};
        const unidade = UNIDADE[String(pi.size_format || '').toLowerCase()] || null;
        const ean = String(d.ean || '').replace(/\D/g, '') || null;
        await pool.query(
          `INSERT INTO catalogo_produto
             (fonte, sku_fonte, ean, nome, marca, categoria_path, categoria, cat_n1, cat_n2, cat_n3,
              formato, unidade_base, formato_valor, preco, moeda, preco_por_base, url, imagem_url, scraped_at)
           VALUES ('mercadona',?,?,?,?,?,?,?,?,?,?,?,?,?,'EUR',?,?,?, NOW())
           ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca),
             categoria_path=VALUES(categoria_path), categoria=VALUES(categoria), cat_n1=VALUES(cat_n1),
             cat_n2=VALUES(cat_n2), cat_n3=VALUES(cat_n3), formato=VALUES(formato), unidade_base=VALUES(unidade_base),
             formato_valor=VALUES(formato_valor), preco=VALUES(preco), preco_por_base=VALUES(preco_por_base),
             url=VALUES(url), imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
          [String(id), ean, tituloProduto(d.display_name).slice(0, 255), tituloProduto(d.brand)?.slice(0, 140) || null,
            [cat?.n1, cat?.n2, cat?.n3].filter(Boolean).join('/') || null, cat?.n3 || null, cat?.n1 || null, cat?.n2 || null, cat?.n3 || null,
            pi.unit_size != null && pi.size_format ? `${pi.unit_size}${pi.size_format}` : (d.packaging || null),
            unidade, num(pi.unit_size), num(pi.unit_price), num(pi.reference_price),
            (d.share_url || null)?.slice(0, 600) || null, (d.thumbnail || null)?.slice(0, 600) || null],
        );
        ok++; if (!ean) semEan++;
      }
    } catch (e) { erro++; if (erro <= 5) console.error('  erro:', id, e.message); }
    feitos++;
    if (feitos % 50 === 0) console.log(`  …${feitos}/${ids.length} (ok ${ok}, s/ean ${semEan}, erro ${erro})`);
    await sleep(DELAY);
  }
  console.log(`\n✅ [mercadona] ${ok} guardados (${semEan} sem EAN), ${erro} erros.`);
  const [[c]] = await pool.query("SELECT COUNT(*) n, COUNT(ean) com_ean FROM catalogo_produto WHERE fonte='mercadona'");
  console.log(`[mercadona] no catálogo: ${c.n} (${c.com_ean} com EAN).`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

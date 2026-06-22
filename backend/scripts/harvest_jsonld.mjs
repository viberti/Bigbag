// HARVESTER GENÉRICO sitemap + schema.org JSON-LD — colhe QUALQUER farmácia NÃO-VTEX
// (Magento, WooCommerce, custom) que publique `<script type="application/ld+json">` com
// um Product (gtin13 + offers.price) nas páginas de produto. Enumera os produtos pelo
// `sitemap.xml` (ou índice de sitemaps) e lê o JSON-LD de cada PDP. É o equivalente do
// harvest_vtex.mjs para o resto do mundo: um adaptador, muitos sites.
//
// Mesmo sem EANs novos, somam PONTOS DE PREÇO (distribuição). A junção com `medicamento`
// é por EAN → guardamos tudo o que tiver gtin13 válido; a "vista de remédio" filtra.
//
// Corre NO SERVIDOR. UPSERT (nunca apaga) + catalogo_preco_hist. Polido; aborta se o host
// se defender (não martela, não evade). NÃO resolve CAPTCHA/desafio.
//
// Uso:
//   sudo -u dev node --env-file=.env scripts/harvest_jsonld.mjs <host> <fonte> [--max=N] [--sitemap=URL] [--proxy]
import { getPool, closePool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';
import { aplicarProxy } from '../src/rede.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*', 'accept-language': 'pt-BR,pt;q=0.9' };
const DELAY = Number(process.env.DELAY || 450);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const eanOk = (s) => { s = String(s || ''); if (!/^\d{13}$/.test(s)) return false; if (s[0] === '2') return false; const d = s.split('').map(Number); const c = d.pop(); let su = 0; for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) su += d[i] * w; return (10 - (su % 10)) % 10 === c; };

async function get(url, ms = 15000) {
  try { const r = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(ms) }); return { status: r.status, text: await r.text() }; }
  catch (e) { return { status: 0, err: e.message }; }
}
const unent = (s) => String(s).replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => unent(m[1].trim()));

// Enumera URLs de produto a partir do(s) sitemap(s). Trata índices de sitemaps.
async function enumerar(host, sitemapArg, max) {
  let roots = [];
  if (sitemapArg) roots = [sitemapArg];
  else {
    const rob = await get(`https://${host}/robots.txt`, 12000);
    roots = [...String(rob.text || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1].trim());
    if (!roots.length) roots = [`https://${host}/sitemap.xml`];
  }
  const urls = new Set(); const seen = new Set(); const fila = [...roots];
  while (fila.length && urls.size < max * 4) {
    const sm = fila.shift(); if (seen.has(sm)) continue; seen.add(sm);
    const r = await get(sm); await sleep(120);
    if (r.status !== 200 || !r.text) continue;
    if (/<sitemapindex/i.test(r.text)) {
      const subs = locs(r.text);
      const prod = subs.filter((s) => /produt|catalog|item|loja|store/i.test(s));
      for (const s of (prod.length ? prod : subs)) fila.push(s);
    } else {
      for (const u of locs(r.text)) {
        // aceita tudo MENOS páginas claramente não-produto; o JSON-LD filtra o resto
        // (em Magento/Woo os URLs de produto são "limpos", sem /produto/ nem .html).
        if (/\/(blog|institucional|sobre|nossas-lojas|lojas|conta|minha-conta|login|checkout|carrinho|sacola|politica|privacidade|termos|contato|fale-conosco|atendimento|ajuda|faq|trabalhe|busca|search)\b/i.test(u)) continue;
        if (u.replace(/^https?:\/\/[^/]+\/?/, '').length < 2) continue; // a própria home
        urls.add(u);
        if (urls.size >= max * 4) break;
      }
    }
  }
  return [...urls];
}

function produtosLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const arr = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
    for (const o of arr) { const t = o && o['@type']; if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) out.push(o); }
  }
  return out;
}
function extrair(o) {
  const gtin = String(o.gtin13 || o.gtin || o.gtin14 || o.gtin12 || (o.isVariantOf && o.isVariantOf.gtin13) || '').replace(/\D/g, '');
  let of = o.offers; if (Array.isArray(of)) of = of.sort((a, b) => num(a.price ?? a.lowPrice) - num(b.price ?? b.lowPrice))[0];
  const preco = of ? num(of.price ?? of.lowPrice ?? (of.priceSpecification && of.priceSpecification.price)) : null;
  const img = o.image ? (Array.isArray(o.image) ? o.image[0] : (typeof o.image === 'object' ? o.image.url : o.image)) : null;
  const marca = o.brand ? (o.brand.name || (typeof o.brand === 'string' ? o.brand : null)) : null;
  return { gtin, preco, nome: o.name ? String(o.name) : null, marca, img: img ? String(img) : null };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--proxy')) aplicarProxy();
  const host = (args[0] || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const fonte = (args[1] || host.replace(/^www\./, '').split('.')[0]).slice(0, 16);
  if (!host || !fonte) { console.log('uso: harvest_jsonld.mjs <host> <fonte> [--max=N] [--sitemap=URL] [--proxy]'); process.exit(1); }
  const max = Number((args.find((x) => x.startsWith('--max=')) || '').slice(6)) || 4000;
  const sitemapArg = (args.find((x) => x.startsWith('--sitemap=')) || '').slice(10) || null;

  console.log(`[jsonld:${fonte}] a enumerar produtos (sitemap)…`);
  const urls = await enumerar(host, sitemapArg, max);
  console.log(`[jsonld:${fonte}] ${urls.length} URLs candidatas. A ler PDPs (delay ${DELAY}ms, máx ${max})…`);
  if (!urls.length) { console.log(`⚠️ [jsonld:${fonte}] 0 URLs — sitemap não encontrado/bloqueado. ABORTADO.`); await closePool(); return; }

  const vals = []; const vistos = new Set(); let lidos = 0, comEan = 0, comPreco = 0, erros = 0, consec = 0;
  for (const url of urls.slice(0, max)) {
    const r = await get(url); await sleep(DELAY); lidos++;
    if (r.status === 403 || r.status === 429 || r.status === 503) { consec++; if (consec >= 8) { console.log(`⚠️ ${consec}× ${r.status} seguidos — ABORTO (host a defender-se).`); break; } await sleep(DELAY * 3); continue; }
    if (r.status !== 200) { erros++; consec++; if (consec >= 12) { console.log('⚠️ muitos erros seguidos — ABORTO.'); break; } continue; }
    consec = 0;
    for (const o of produtosLd(r.text)) {
      const p = extrair(o);
      if (!eanOk(p.gtin)) continue; comEan++;
      if (p.preco == null || p.preco <= 0) continue; comPreco++;
      if (vistos.has(p.gtin)) continue; vistos.add(p.gtin);
      vals.push([fonte, p.gtin, p.gtin, p.nome ? tituloProduto(p.nome.slice(0, 255)) : null, p.marca ? tituloProduto(String(p.marca).slice(0, 140)) : null, p.preco, 'BRL', url.slice(0, 600), p.img ? p.img.slice(0, 600) : null]);
    }
    if (lidos % 100 === 0) process.stdout.write(`\r[jsonld:${fonte}] ${lidos}/${Math.min(urls.length, max)} · c/EAN ${comEan} · c/preço ${comPreco} · únicos ${vals.length} · err ${erros}   `);
  }
  console.log(`\n[jsonld:${fonte}] ${vals.length} produtos com EAN+preço. A gravar…`);
  if (!vals.length) { console.log(`⚠️ [jsonld:${fonte}] 0 produtos úteis (sem gtin13/preço no JSON-LD?). Dados existentes MANTIDOS.`); await closePool(); return; }

  const pool = getPool();
  const [cur] = await pool.query('SELECT sku_fonte, preco FROM catalogo_produto WHERE fonte = ?', [fonte]);
  const atual = new Map(cur.map((r) => [r.sku_fonte, r.preco == null ? null : Number(r.preco)]));
  const hist = [];
  for (const v of vals) { const ant = atual.has(v[1]) ? atual.get(v[1]) : undefined; if (ant === undefined || ant === null || Number(ant) !== Number(v[5])) hist.push([fonte, v[1], v[2], v[5], 'BRL']); }
  for (let i = 0; i < vals.length; i += 500) {
    await pool.query(
      `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, preco, moeda, url, imagem_url, scraped_at)
       VALUES ${vals.slice(i, i + 500).map(() => '(?,?,?,?,?,?,?,?,?,NOW())').join(',')}
       ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), preco=VALUES(preco),
         moeda=VALUES(moeda), url=VALUES(url), imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
      vals.slice(i, i + 500).flat(),
    );
  }
  for (let i = 0; i < hist.length; i += 500) {
    await pool.query(`INSERT INTO catalogo_preco_hist (fonte, sku_fonte, ean, preco, moeda, visto_em) VALUES ${hist.slice(i, i + 500).map(() => '(?,?,?,?,?,NOW())').join(',')}`, hist.slice(i, i + 500).flat());
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(DISTINCT ean) e FROM catalogo_produto WHERE fonte = ?', [fonte]);
  const [[m]] = await pool.query(`SELECT COUNT(DISTINCT cp.ean) n FROM catalogo_produto cp JOIN medicamento md ON md.ean=cp.ean WHERE cp.fonte=?`, [fonte]);
  console.log(`✅ [jsonld:${fonte}] catálogo: ${c.n} linhas | ${c.e} EANs (${m.n} são remédios do CMED) | +${hist.length} no histórico de preço.`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

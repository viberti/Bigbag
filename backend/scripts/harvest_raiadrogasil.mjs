// ADAPTADOR RaiaDrogasil (drogasil.com.br / drogaraia.com.br) — a GIGANTE do varejo
// farma BR, que NÃO é VTEX (Next.js próprio atrás de Cloudflare). Colhe preço por EAN
// de forma LEGÍTIMA e DIRECIONADA: para cada EAN que já seguimos (tem oferta noutra
// farmácia ou está no CMED), faz `search?w=<EAN>` (devolve o produto exato) e lê o
// bloco **schema.org JSON-LD** da página do produto — `gtin13` + `offers.price` —, os
// dados estruturados que o site PUBLICA para crawlers. NÃO resolve desafios/CAPTCHA;
// se o host começar a defender-se (403/503 seguidos), ABORTA (não martela, não evade).
//
// Grava no MESMO pipeline endurecido: catalogo_produto (UPSERT) + catalogo_preco_hist.
//
// Uso (no SERVIDOR):
//   sudo -u dev node --env-file=.env scripts/harvest_raiadrogasil.mjs [--limite=N] [--atualizar] [--host=www.drogasil.com.br] [--fonte=drogasil]
//     --limite=N    quantos EANs processar (default 200; 0 = todos os alvo)
//     --atualizar   re-buscar EANs que já temos da RD (refrescar preço); senão só os em falta
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';
import { aplicarProxy } from '../src/rede.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*', 'accept-language': 'pt-BR,pt;q=0.9' };
const DELAY = Number(process.env.DELAY || 700); // gentil por defeito
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FARMACIAS = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8')).map((f) => f.fonte);

async function getHtml(url) {
  const r = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const txt = await r.text();
  return { status: r.status, txt };
}
const nextData = (html) => { const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
const jsonLdProduto = (html) => {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const o = JSON.parse(m[1]); if (o && o['@type'] === 'Product') return o; } catch { /* ignora bloco inválido */ }
  }
  return null;
};
// desce no JSON à procura do 1.º array "products" com itens que têm url
function acharProdutos(o, out = []) {
  if (!o || typeof o !== 'object') return out;
  if (Array.isArray(o.products) && o.products.length && (o.products[0].url || o.products[0].slug)) out.push(o.products);
  for (const k in o) acharProdutos(o[k], out);
  return out;
}

async function alvos(pool, { limite, atualizar }) {
  // EANs relevantes p/ comparação: estão no CMED E já têm oferta numa das nossas farmácias.
  const inFar = '(' + FARMACIAS.map(() => '?').join(',') + ')';
  const cond = atualizar ? '' : "AND NOT EXISTS (SELECT 1 FROM catalogo_produto rd WHERE rd.ean=m.ean AND rd.fonte='drogasil')";
  const [rows] = await pool.query(
    `SELECT DISTINCT m.ean, m.produto FROM medicamento m
       JOIN catalogo_produto cp ON cp.ean=m.ean AND cp.preco IS NOT NULL AND cp.fonte IN ${inFar}
      WHERE 1=1 ${cond}
      ORDER BY m.ean ${limite ? 'LIMIT ' + limite : ''}`,
    FARMACIAS,
  );
  return rows;
}

async function precoDoEan(host, ean) {
  // 1) busca pelo EAN → produto exato (url)
  const b = await getHtml(`https://${host}/search?w=${ean}`);
  if (b.status !== 200) return { status: b.status };
  const lista = acharProdutos(nextData(b.txt)?.props || {})[0];
  const prod = (lista || []).find(Boolean);
  if (!prod) return { naoEncontrado: true };
  const url = String(prod.url || '').split('?')[0];
  if (!url) return { naoEncontrado: true };
  await sleep(DELAY);
  // 2) PDP → JSON-LD (gtin13 + offers.price)
  const p = await getHtml(`https://${host}${url.startsWith('/') ? url : '/' + url}`);
  if (p.status !== 200) return { status: p.status };
  const ld = jsonLdProduto(p.txt);
  if (!ld) return { semLd: true };
  const of = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  const gtin = String(ld.gtin13 || ld.gtin || '').replace(/\D/g, '');
  const preco = of ? Number(of.price) : null;
  return {
    gtin, preco: Number.isFinite(preco) ? preco : null,
    nome: ld.name ? tituloProduto(String(ld.name).slice(0, 255)) : (prod.name || null),
    marca: (ld.brand?.name || ld.brand || prod.brand) ? tituloProduto(String(ld.brand?.name || ld.brand || prod.brand).slice(0, 140)) : null,
    sku: String(ld.sku || prod.sku || prod.objectID || ean).slice(0, 24),
    imagem: (ld.image && (Array.isArray(ld.image) ? ld.image[0] : ld.image)) || prod.image?.src || null,
    url: `https://${host}${url}`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
  const host = arg('host', 'www.drogasil.com.br');
  const fonte = arg('fonte', 'drogasil');
  const limite = Number(arg('limite', '200'));
  const atualizar = args.includes('--atualizar');
  if (args.includes('--proxy')) aplicarProxy();

  const pool = getPool();
  const lista = await alvos(pool, { limite, atualizar });
  console.log(`[${fonte}] ${lista.length} EANs alvo (${atualizar ? 'incl. atualização' : 'só em falta'}). Delay ${DELAY}ms.`);

  const upserts = []; const hist = [];
  let ok = 0, naoTem = 0, semPreco = 0, mism = 0, erros = 0, consecErro = 0;
  // preços atuais da RD p/ detetar mudança no histórico
  const [cur] = await pool.query('SELECT ean, preco FROM catalogo_produto WHERE fonte=?', [fonte]);
  const precoAtual = new Map(cur.map((r) => [r.ean, r.preco == null ? null : Number(r.preco)]));

  for (let i = 0; i < lista.length; i++) {
    const { ean } = lista[i];
    let r;
    try { r = await precoDoEan(host, ean); }
    catch (e) { erros++; consecErro++; if (consecErro >= 6) { console.log(`⚠️ ${consecErro} erros seguidos — ABORTO (host a defender-se; não martelar).`); break; } await sleep(DELAY * 2); continue; }
    if (r.status === 403 || r.status === 503 || r.status === 429) {
      consecErro++; if (consecErro >= 6) { console.log(`⚠️ ${consecErro}× ${r.status} seguidos — ABORTO (proteção do host; não evadir).`); break; }
      await sleep(DELAY * 3); continue;
    }
    consecErro = 0;
    if (r.naoEncontrado) { naoTem++; }
    else if (r.semLd || r.preco == null) { semPreco++; }
    else if (r.gtin && r.gtin !== String(ean)) { mism++; } // guard: a página tem de ser o MESMO EAN
    else {
      ok++;
      upserts.push([fonte, r.sku, ean, r.nome, r.marca, r.preco, 'BRL', r.url, r.imagem]);
      const ant = precoAtual.has(ean) ? precoAtual.get(ean) : undefined;
      if (ant === undefined || ant === null || Number(ant) !== Number(r.preco)) hist.push([fonte, r.sku, ean, r.preco, 'BRL']);
    }
    if (i % 25 === 0) process.stdout.write(`\r[${fonte}] ${i + 1}/${lista.length} · ok ${ok} · sem ${naoTem} · s/preço ${semPreco} · mism ${mism} · err ${erros}   `);
    await sleep(DELAY);
  }

  // UPSERT (nunca apaga) + histórico de preço (só mudanças)
  for (let i = 0; i < upserts.length; i += 300) {
    const lote = upserts.slice(i, i + 300);
    await pool.query(
      `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, preco, moeda, url, imagem_url, scraped_at)
       VALUES ${lote.map(() => '(?,?,?,?,?,?,?,?,?,NOW())').join(',')}
       ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), preco=VALUES(preco),
         moeda=VALUES(moeda), url=VALUES(url), imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
      lote.flat(),
    );
  }
  for (let i = 0; i < hist.length; i += 300) {
    const lote = hist.slice(i, i + 300);
    await pool.query(
      `INSERT INTO catalogo_preco_hist (fonte, sku_fonte, ean, preco, moeda, visto_em) VALUES ${lote.map(() => '(?,?,?,?,?,NOW())').join(',')}`,
      lote.flat(),
    );
  }
  console.log(`\n✅ [${fonte}] gravados ${ok} preços (${hist.length} mudanças no histórico) · RD não tem ${naoTem} · sem preço ${semPreco} · EAN divergente ${mism} · erros ${erros}.`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

// Importa o catálogo do E.LECLERC ES (subdomínio regional, plataforma comerzzia/
// Liferay) → catalogo_produto (fonte='leclerc'). NÃO há API JSON nem sitemap de
// produtos; a paginação das categorias é AJAX jQuery (difícil). Solução: CRAWL BFS
// — as fichas de produto ligam a ~15-20 relacionados, por isso a partir das 13
// categorias-semente descobre-se o catálogo todo seguindo os links /Producto/.
//
// Por produto: EAN no ÚLTIMO segmento do URL · JSON-LD (nome/marca/preço). SEM
// nutrição (o site só põe um disclaimer "contacte o apoio"). IMAGEM IGNORADA — é
// EAN-keyed mas o ficheiro é ERRADO (caso Penne↔Pipe Rigate, verificado). Preço é
// da loja regional (referência, não facto — ver preco-catalogo-referencia).
// Upsert por (fonte, sku_fonte=segmento do URL) → idempotente. Educado + breaker.
//   sudo -u dev node --env-file=.env scripts/importar_leclerc.mjs [--limite=0]
import { getPool } from '../src/db.js';
import { eanValido } from '../src/ingest/produto.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';

const HOST = process.env.LECLERC_HOST || 'https://pamplona.e-leclerc.es';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LIMITE = Number((process.argv.find((a) => a.startsWith('--limite=')) || '').split('=')[1]) || 0;
const CONC = Number(process.env.CONC || 4);
const DELAY = Number(process.env.DELAY || 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RE_PROD = /\/detalle\/-\/Producto\/[^"'\s<>]+/gi;

async function fetchText(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }, signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { if (i === tentativas - 1) throw e; await sleep(600 * (i + 1)); }
  }
}

const segDoUrl = (u) => decodeURIComponent(u.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '');
// o bloco ld+json do Leclerc é JSON INVÁLIDO (usa aspas simples: availability:'InStock')
// → JSON.parse falha. Extraímos os campos por REGEX no bloco (robusto). Só precisamos
// de nome/marca/preço/moeda; o EAN vem do URL.
function blocoProduto(html) {
  return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]).find((b) => /"@type"\s*:\s*"Product"/.test(b)) || null;
}
const campo = (re, s) => { const m = s.match(re); return m ? m[1] : null; };

// produto → linha (ou null se não der). NÃO grava imagem (foto não-fiável).
function rowDe(url, html) {
  const blk = blocoProduto(html); if (!blk) return null;
  const nome = (campo(/"name"\s*:\s*"([^"]*)"/, blk) || '').trim(); if (!nome) return null;
  const seg = segDoUrl(url); if (!seg) return null;
  const ean = seg.replace(/\D/g, '');
  let marca = campo(/"brand"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]*)"/, blk) || '';
  if (/^null$/i.test(marca)) marca = '';
  const precoStr = campo(/"price"\s*:\s*['"]?(\d+(?:\.\d+)?)/, blk); // preço com PONTO decimal
  const preco = precoStr != null ? Number(precoStr) : null;
  const moeda = campo(/"priceCurrency"\s*:\s*['"]?([A-Z]{3})/, blk) || 'EUR';
  const fmt = extrairFormato(nome);
  const ppb = preco != null && fmt ? precoPorBase({ preco_liquido: preco, quantidade: 1 }, fmt) : null;
  return [
    'leclerc', seg.slice(0, 24), eanValido(ean) ? ean : null, nome.slice(0, 255), marca.slice(0, 140) || null,
    fmt ? `${fmt.formato_valor ?? ''}${fmt.unidade_base ?? ''}`.trim() || null : null,
    fmt?.unidade_base || null, fmt?.formato_valor ?? null, preco, ppb, moeda, url.slice(0, 600),
  ];
}

const COLS = 'fonte, sku_fonte, ean, nome, marca, formato, unidade_base, formato_valor, preco, preco_por_base, moeda, url, scraped_at';
async function gravar(pool, rows) {
  if (!rows.length) return;
  const ph = rows.map(() => '(' + new Array(12).fill('?').join(',') + ',NOW())').join(',');
  await pool.query(
    `INSERT INTO catalogo_produto (${COLS}) VALUES ${ph}
     ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), formato=VALUES(formato),
       unidade_base=VALUES(unidade_base), formato_valor=VALUES(formato_valor), preco=VALUES(preco),
       preco_por_base=VALUES(preco_por_base), moeda=VALUES(moeda), url=VALUES(url), scraped_at=NOW()`, rows.flat());
}

const pool = getPool();

// sementes: as 13 categorias da home → URLs de produto iniciais
const home = await fetchText(HOST + '/');
const cats = [...new Set([...(home || '').matchAll(/\/categorias\/[a-z0-9-]+\/\d+/gi)].map((m) => m[0]))];
console.log(`[leclerc] ${cats.length} categorias-semente em ${HOST}`);
const seen = new Set();           // URLs já enfileiradas (chave = caminho do produto)
const fila = [];
const enfileirar = (u) => {
  const abs = u.startsWith('http') ? u : HOST + u;
  const chave = abs.split(/[?#]/)[0];
  if (!seen.has(chave)) { seen.add(chave); fila.push(abs); }
};
for (const c of cats) {
  const cb = await fetchText(HOST + c);
  for (const m of (cb || '').matchAll(RE_PROD)) enfileirar(m[0]);
  await sleep(DELAY);
}
console.log(`[leclerc] ${fila.length} produtos-semente. A iniciar BFS…\n`);

let ok = 0, semFicha = 0, comEan = 0, erro = 0, errosSeguidos = 0, processados = 0;
const t0 = Date.now();
while (fila.length) {
  if (LIMITE && ok >= LIMITE) break;
  if (errosSeguidos >= 25) { console.error(`\n[leclerc] ${errosSeguidos} erros seguidos — bloqueio provável, a abortar (idempotente, retoma).`); break; }
  const lote = fila.splice(0, CONC);
  const rows = (await Promise.all(lote.map(async (url) => {
    try {
      const html = await fetchText(url);
      processados++;
      if (!html) { semFicha++; errosSeguidos = 0; return null; }
      for (const m of html.matchAll(RE_PROD)) enfileirar(m[0]); // descobre relacionados (BFS)
      const r = rowDe(url, html);
      errosSeguidos = 0;
      if (!r) { semFicha++; return null; }
      if (r[2]) comEan++;
      return r;
    } catch (e) { erro++; errosSeguidos++; if (erro <= 5) console.error('  erro', segDoUrl(url), e.message); return null; }
  }))).filter(Boolean);
  if (rows.length) { await gravar(pool, rows); ok += rows.length; }
  if (processados % 100 < CONC) {
    const rps = (processados / ((Date.now() - t0) / 1000)).toFixed(1);
    process.stderr.write(`\r  ${ok} guardados · ${comEan} c/ EAN · fila ${fila.length} · vistos ${seen.size} · ${erro} erro · ${rps}/s   `);
  }
  await sleep(DELAY);
}

console.log(`\n\n✅ [leclerc] ${ok} produtos (${comEan} c/ EAN válido) · ${semFicha} sem ficha · ${erro} erros · ${seen.size} URLs vistos · ${Math.round((Date.now() - t0) / 1000)}s`);
const [[c]] = await pool.query("SELECT COUNT(*) n, COUNT(ean) com_ean FROM catalogo_produto WHERE fonte='leclerc'");
console.log(`[leclerc] no catálogo: ${c.n} (${c.com_ean} com EAN).`);
await pool.end();
process.exit(0);

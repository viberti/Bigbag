// HARVESTER da Nutripedia (nutripedia.pt) — base PT de produtos rica em EAN + nome +
// marca + ingredientes + NUTRICAO (incl. micronutrientes) + foto. ~39k produtos.
//
// PORQUE CORRE NO PC (e nao no servidor): a Nutripedia esta atras de Cloudflare e
// devolve 403 a IPs de datacenter (o servidor apanha challenge). O IP residencial
// do PC passa. Por isso a RECOLHA faz-se aqui e escreve um NDJSON; o CARREGAMENTO
// na BD faz-se no servidor com scripts/carregar_nutripedia.mjs (le o NDJSON).
//
// A app e Angular SSR: embebe a resposta de /api/product/{id} INLINE num
// <script type="application/json"> (transfer-state), com a chave = base64("/api/product/{id}").
// O robots permite /produtos/{id} (so bloqueia /api/) -> recolhemos as PAGINAS, nao a API.
// O `body` traz: { id, ean[], nome, marca, ingredientes, unidade (base: por 100<unidade>),
// nutrientes:{<id>:{q,u}} }. Os ids de nutriente sao numericos -> o mapa id->macro
// deriva-se no carregador por triangulacao com a nutricao que ja temos.
//
// Educado: UA de browser, concorrencia baixa, delay, resumivel (salta ids ja no NDJSON).
//
// Uso (no PC):  node scripts/harvest_nutripedia.mjs [ficheiroSaida] [maxProdutos]
//   ex.: node scripts/harvest_nutripedia.mjs nutripedia.ndjson 400   (piloto)
//        node scripts/harvest_nutripedia.mjs nutripedia.ndjson       (tudo)
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const SAIDA = process.argv[2] || 'nutripedia.ndjson';
const MAX = Number(process.argv[3] || 0);
// Cloudflare rate-limita: manter concorrencia BAIXA e delay generoso. 429 -> backoff.
const POOL = Number(process.env.POOL || 2);
const DELAY = Number(process.env.DELAY || 350);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const eanOk = (s) => {
  s = String(s); if (!/^\d{13}$/.test(s)) return false; if (s[0] === '2') return false; // 2.. = peso variavel interno
  const d = s.split('').map(Number); const c = d.pop(); let su = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) su += d[i] * w;
  return (10 - (su % 10)) % 10 === c;
};
async function get(u, ms = 20000) {
  // Backoff em 429/503 (rate-limit/escudo Cloudflare): espera crescente e tenta de novo.
  for (let tent = 0; ; tent++) {
    let r;
    try { r = await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'pt-PT,pt;q=0.9' }, signal: AbortSignal.timeout(ms) }); }
    catch (e) { if (tent >= 4) throw e; await sleep(1500 * (tent + 1)); continue; }
    if ((r.status === 429 || r.status === 503) && tent < 6) { await sleep(2000 * (tent + 1)); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
}
const locs = (x) => [...String(x).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

// Extrai o body de /api/product/{id} do transfer-state (chave = base64 do path).
function parseProduto(html) {
  const m = html.match(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  let j; try { j = JSON.parse(m[1]); } catch { return null; }
  const k = Object.keys(j).find((x) => { try { return /^\/api\/product\/\d+$/.test(Buffer.from(x, 'base64').toString()); } catch { return false; } });
  const b = k && j[k]?.body;
  if (!b || b._ !== 'Product') return null;
  return b;
}

async function main() {
  console.log('[nutripedia] a ler sitemap…');
  const sm = await get('https://nutripedia.pt/sitemap.xml');
  let ids = [...new Set(locs(sm).map((u) => (u.match(/\/produtos\/(\d+)/) || [])[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const totalSitemap = ids.length;

  // resumivel: salta ids ja escritos
  const feitos = new Set();
  if (existsSync(SAIDA)) {
    for (const ln of readFileSync(SAIDA, 'utf8').split('\n')) { if (!ln.trim()) continue; try { feitos.add(JSON.parse(ln).id); } catch { /* linha incompleta */ } }
  }
  ids = ids.filter((id) => !feitos.has(id));
  if (MAX > 0) ids = ids.slice(0, MAX);
  console.log(`[nutripedia] sitemap: ${totalSitemap} | ja feitos: ${feitos.size} | a recolher: ${ids.length} (pool=${POOL}, delay=${DELAY}ms) -> ${SAIDA}`);

  let ok = 0, semEan = 0, semFicha = 0, erro = 0, feito = 0;
  async function worker(lista) {
    for (const id of lista) {
      try {
        const html = await get('https://nutripedia.pt/produtos/' + id);
        const b = parseProduto(html);
        if (!b) { semFicha++; }
        else {
          const eans = [...new Set((b.ean || []).filter(eanOk))];
          if (!eans.length) { semEan++; }
          else {
            const rec = {
              id: b.id, eans, nome: b.nome || null, marca: b.marca || null,
              ingredientes: b.ingredientes || null, base: b.unidade || null,
              nutrientes: b.nutrientes || null, imagem: `https://nutripedia.pt/assets/product/${b.id}/image.png`,
            };
            appendFileSync(SAIDA, JSON.stringify(rec) + '\n');
            ok++;
          }
        }
      } catch (e) { erro++; if (erro <= 5) console.error('  erro', id, e.message); }
      feito++;
      if (feito % 200 === 0) console.log(`  …${feito}/${ids.length} (ok ${ok}, s/ean ${semEan}, s/ficha ${semFicha}, erro ${erro})`);
      await sleep(DELAY);
    }
  }
  const baldes = Array.from({ length: POOL }, () => []);
  ids.forEach((id, i) => baldes[i % POOL].push(id));
  await Promise.all(baldes.map(worker));
  console.log(`\n✅ [nutripedia] ${ok} produtos c/ EAN guardados | ${semEan} s/ean | ${semFicha} s/ficha | ${erro} erros. Ficheiro: ${SAIDA}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

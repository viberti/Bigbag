// ENRIQUECIMENTO DE EAN da Extra (2.º passo, RESUMÍVEL — à la Continente gota-a-gota).
// A listagem da Extra (harvest_extra.mjs) não traz EAN; a PDP (`__NEXT_DATA__`) traz `"ean":"…"`
// exatamente UMA vez (o próprio produto, sem relacionados a confundir). Aqui visitamos as PDPs das
// linhas fonte='extra' com ean NULL, extraímos+validamos o EAN (checksum EAN-13) e gravamos.
//   - PDP dinâmica (SSR): ~336 KB cada, sem suporte a Range → custo real; por isso CAP por execução
//     (argv[2], default 1500) p/ correr aos poucos (cron). Re-correr continua de onde parou (ean NULL).
//   - Educado: concorrência baixa + delay; backoff em 429/5xx.
//   sudo -u dev node --env-file=.env scripts/enriquecer_extra_ean.mjs [maxProdutos|all] [concorrencia]
import { getPool, closePool } from '../src/db.js';

const FONTE = 'extra';
const arg = (process.argv[2] || '1500').toLowerCase();
const CAP = arg === 'all' ? 1e9 : Math.max(1, Number(arg) || 1500);
const POOL = Math.max(1, Math.min(5, Number(process.argv[3]) || 3));
const DELAY = 250;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// checksum EAN-8/13 (mesma regra do harvest_vtex): rejeita PLU/lixo.
function eanOk(s) {
  if (!/^\d{8,14}$/.test(s)) return false;
  const d = s.split('').map(Number);
  const c = d.pop();
  let soma = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) soma += d[i] * w;
  return (10 - (soma % 10)) % 10 === c;
}

async function pdpEan(url) {
  for (let t = 0; ; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(25000) });
      if ((r.status === 429 || r.status >= 500) && t < 4) { await sleep(1200 * (t + 1)); continue; }
      if (r.status === 404) return { gone: true };
      if (!r.ok) return { erro: r.status };
      const html = await r.text();
      const m = html.match(/"ean":"(\d{8,14})"/); // 1 ocorrência = o próprio produto
      if (!m) return { semEan: true };
      return eanOk(m[1]) ? { ean: m[1] } : { invalido: m[1] };
    } catch (e) { if (t >= 4) return { erro: e.name || 'fetch' }; await sleep(1000 * (t + 1)); }
  }
}

async function main() {
  const pool = getPool();
  const [linhas] = await pool.query(
    `SELECT sku_fonte, url FROM catalogo_produto
      WHERE fonte = ? AND ean IS NULL AND url LIKE '%/produto/%'
      ORDER BY id LIMIT ?`, [FONTE, CAP]);
  const [[rest]] = await pool.query(
    `SELECT COUNT(*) n FROM catalogo_produto WHERE fonte = ? AND ean IS NULL AND url LIKE '%/produto/%'`, [FONTE]);
  console.log(`[extra:ean] a processar ${linhas.length} PDPs (restantes sem EAN no total: ${rest.n}); pool=${POOL}, delay=${DELAY}ms`);

  let ok = 0, sem = 0, inval = 0, gone = 0, err = 0, feitos = 0;
  for (let i = 0; i < linhas.length; i += POOL) {
    const lote = linhas.slice(i, i + POOL);
    await Promise.all(lote.map(async (l) => {
      const r = await pdpEan(l.url);
      feitos++;
      if (r.ean) { await pool.query('UPDATE catalogo_produto SET ean = ?, scraped_at = NOW() WHERE fonte = ? AND sku_fonte = ?', [r.ean, FONTE, l.sku_fonte]); ok++; }
      else if (r.semEan) sem++;
      else if (r.invalido) inval++;
      else if (r.gone) gone++;
      else err++;
    }));
    if (feitos % 100 < POOL) process.stderr.write(`\r  ${feitos}/${linhas.length} · ean ok:${ok} s/ean:${sem} inval:${inval} 404:${gone} err:${err}   `);
    await sleep(DELAY);
  }
  process.stderr.write('\n');
  const [[c]] = await pool.query(`SELECT COUNT(*) n, SUM(ean IS NOT NULL) e FROM catalogo_produto WHERE fonte = ?`, [FONTE]);
  console.log(`✅ extra: +${ok} EANs nesta corrida (s/ean ${sem}, inválidos ${inval}, 404 ${gone}, erros ${err}). Total: ${c.e}/${c.n} c/ EAN. Faltam ~${rest.n - ok} (re-correr p/ continuar).`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

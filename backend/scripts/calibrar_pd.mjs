// CALIBRAÇÃO do match-por-imagem CROSS-LOJA: pega N produtos Pingo Doce (sem EAN),
// embeda a imagem, procura no catálogo COM EAN (Qdrant) e cruza o score visual com
// a concordância de NOMES (única verdade possível sem EAN). Mostra a distribuição
// para escolher o limiar.  sudo -u dev node --env-file=.env scripts/calibrar_pd.mjs [--n=300]
import { getPool } from '../src/db.js';
import { matchPorVetor } from '../src/normaliza/matchImagem.js';
import { normAlfa } from '../src/normaliza/categoria.js';

const INFER = process.env.INFER_URL || 'http://localhost:8900';
const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1]) || 300;
const LOTE = 16;
const pool = getPool();

const [pds] = await pool.query(
  `SELECT id, nome, imagem_url FROM catalogo_produto
    WHERE fonte='pingodoce' AND imagem_url<>'' AND imagem_url IS NOT NULL AND nome IS NOT NULL
    ORDER BY RAND() LIMIT ?`, [N]);

const baixar = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch { return null; }
};

const itens = [];
for (let i = 0; i < pds.length; i += 8) {
  const lote = pds.slice(i, i + 8);
  const b = await Promise.all(lote.map((x) => baixar(x.imagem_url)));
  lote.forEach((x, j) => { if (b[j]) itens.push({ ...x, b64: b[j] }); });
  process.stderr.write(`\r  baixadas ${itens.length}`);
}
console.error(`\n  ${itens.length}/${pds.length} imagens baixadas`);

const resultados = [];
for (let i = 0; i < itens.length; i += LOTE) {
  const lote = itens.slice(i, i + LOTE);
  const r = await fetch(`${INFER}/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b64: lote.map((x) => x.b64) }) });
  const d = await r.json();
  for (let j = 0; j < lote.length; j++) {
    const vec = d.itens?.[j]?.vec; if (!vec) continue;
    const cands = await matchPorVetor(vec, { k: 3 });
    resultados.push({ pd: lote[j], best: cands[0] || null });
  }
  process.stderr.write(`\r  embed+match ${Math.min(i + LOTE, itens.length)}/${itens.length}`);
}
console.error('');

// nomes dos produtos casados (pelo id do ponto Qdrant = id da linha de catálogo)
const ids = [...new Set(resultados.filter((r) => r.best).map((r) => r.best.id))];
const byId = new Map();
if (ids.length) {
  const [rows] = await pool.query(`SELECT id, nome, fonte FROM catalogo_produto WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  for (const x of rows) byId.set(x.id, x);
}
const toks = (s) => new Set(normAlfa(s).split(' ').filter((t) => t.length >= 4));
const overlap = (a, b) => { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.min(A.size, B.size); };

const linhas = resultados.map((r) => {
  const m = r.best ? byId.get(r.best.id) : null;
  return { score: r.best?.score ?? 0, pd: r.pd.nome, match: m?.nome || '—', fonte: m?.fonte || '', ov: m ? overlap(r.pd.nome, m.nome) : 0 };
}).sort((a, b) => b.score - a.score);

const buckets = [[0.9, 1.01], [0.85, 0.9], [0.8, 0.85], [0.75, 0.8], [0.7, 0.75], [0, 0.7]];
console.log('\n=== DISTRIBUIÇÃO (score visual → nº · nomes concordam ov>=0.4) ===');
for (const [lo, hi] of buckets) {
  const b = linhas.filter((l) => l.score >= lo && l.score < hi);
  const conc = b.filter((l) => l.ov >= 0.4).length;
  console.log(`  ${lo.toFixed(2)}–${hi < 1 ? hi.toFixed(2) : '1.00'}: ${String(b.length).padStart(3)} · concordam ${String(conc).padStart(3)} (${b.length ? Math.round(100 * conc / b.length) : 0}%)`);
}
console.log('\n=== AMOSTRAS (score · ov · PD  ->  match [loja]) ===');
for (const [lo, hi] of buckets) {
  const b = linhas.filter((l) => l.score >= lo && l.score < hi).slice(0, 6);
  if (!b.length) continue;
  console.log(` ── ${lo.toFixed(2)}–${hi < 1 ? hi.toFixed(2) : '1.00'} ──`);
  for (const l of b) console.log(`  ${l.score.toFixed(3)} ov${l.ov.toFixed(2)}  ${l.pd.slice(0, 32).padEnd(32)} -> ${l.match.slice(0, 32).padEnd(32)} [${l.fonte}]`);
}
await pool.end();

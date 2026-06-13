// PROFILING (one-off, não-destrutivo): mede o resolverItensLista contra os itens
// REAIS da despensa. Envolve pool.query para contar nº de queries, tempo total em
// BD, e as 8 queries mais lentas (texto normalizado). Diz se o custo é N+1 (muitas
// queries) ou poucas queries lentas.  sudo -u dev node --env-file=.env scripts/prof_despensa.mjs
import { getPool } from '../src/db.js';
import { resolverItensLista } from '../src/routes/lista.js';

const pool = getPool();
const [rows] = await pool.query(
  `SELECT ean, nome, marca, validade FROM despensa ORDER BY atualizado_em DESC, id DESC`);
const itens = rows.map((r) => ({ id: r.ean, nome: r.nome, ean: r.ean, estado: 'ativo', quantidade: 1, marca_scan: r.marca, validade: r.validade, data: null }));
console.log('itens da despensa:', itens.length);

// instrumenta pool.query
const orig = pool.query.bind(pool);
let n = 0, tDB = 0;
const porTexto = new Map(); // sql normalizado → {n, ms}
pool.query = async (...args) => {
  const sql = String(args[0]).replace(/\s+/g, ' ').trim().slice(0, 90);
  const t0 = Date.now();
  const r = await orig(...args);
  const dt = Date.now() - t0;
  n++; tDB += dt;
  const g = porTexto.get(sql) || { n: 0, ms: 0 };
  g.n++; g.ms += dt; porTexto.set(sql, g);
  return r;
};

const clone = () => rows.map((r) => ({ id: r.ean, nome: r.nome, ean: r.ean, estado: 'ativo', quantidade: 1, marca_scan: r.marca, validade: r.validade, data: null }));
console.error('\n━━━ PASSAGEM 1 (FRIA) ━━━');
const t0 = Date.now();
await resolverItensLista(pool, clone(), null, { leve: true });
const wall = Date.now() - t0;
console.error('\n━━━ PASSAGEM 2 (QUENTE — caches já carregados) ━━━');
const t1 = Date.now();
await resolverItensLista(pool, clone(), null, { leve: true });
console.error(`  WALL passagem 2 (quente): ${Date.now() - t1}ms`);
pool.query = orig;

console.log(`\nWALL: ${wall}ms · queries: ${n} · tempo em BD: ${tDB}ms · CPU/resto: ${wall - tDB}ms`);
console.log('\n── queries por padrão (n × total ms), top 12 por tempo ──');
[...porTexto.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)
  .forEach(([sql, g]) => console.log(`  ${String(g.ms).padStart(6)}ms  ×${String(g.n).padStart(3)}  ${sql}`));
await pool.end();

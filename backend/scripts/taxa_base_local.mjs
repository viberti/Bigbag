// Relatório da TAXA DE ACERTO da base local (base_local_evento, migração 067): quantos EANs
// foram resolvidos NO TELEFONE (hit, instantâneo/offline) vs tiveram de ir ao servidor (miss),
// e — pelos misses — O QUE FALTA na base (p.ex. LIDL/ALDI europeus, deixados de fora). Read-only.
// "Começar com menos, medir, ajustar" (dono, 2026-06-17): correr isto periodicamente e decidir
// o que adicionar a seguir pelos misses mais frequentes.
//   sudo -u dev node --env-file=.env scripts/taxa_base_local.mjs
import { getPool } from '../src/db.js';

const pool = getPool();
const [[g]] = await pool.query('SELECT COUNT(*) tot, SUM(hit) hits, SUM(hit=0) miss FROM base_local_evento');
if (!g.tot) {
  console.log('Sem eventos ainda — usa o app (scan/consulta de EANs) e volta a correr.');
  console.log(`(base_local tem ${(await pool.query('SELECT COUNT(*) n FROM base_local'))[0][0].n} fichas carregadas)`);
  await pool.end();
  process.exit(0);
}
console.log(`TOTAL: ${g.tot}  ·  HIT (telefone): ${g.hits} (${(g.hits / g.tot * 100).toFixed(1)}%)  ·  MISS (servidor): ${g.miss}`);

const [porOrigem] = await pool.query('SELECT origem, COUNT(*) n, SUM(hit) hits FROM base_local_evento GROUP BY origem ORDER BY n DESC');
console.log('\nPor contexto:');
for (const o of porOrigem) console.log(`  ${(o.origem || '?').padEnd(10)} ${String(o.n).padStart(4)} eventos · ${(o.hits / o.n * 100).toFixed(0)}% hit`);

// MISSES: cruza com off_full p/ ver nome/país — são os candidatos a adicionar à base.
const [misses] = await pool.query(
  `SELECT e.ean, COUNT(*) vezes, MAX(o.nome) nome, MAX(o.marca) marca, MAX(o.paises_tags) paises
     FROM base_local_evento e LEFT JOIN off_full o ON o.ean = e.ean
    WHERE e.hit = 0 AND e.ean IS NOT NULL AND e.ean <> ''
    GROUP BY e.ean ORDER BY vezes DESC, e.ean LIMIT 40`,
);
if (misses.length) {
  console.log('\nTop MISSES (o que falta — candidatos a adicionar):');
  for (const m of misses) {
    const pais = (m.paises || '').replace(/en:/g, '').split(',').filter(Boolean).slice(0, 3).join(',') || '—';
    console.log(`  ${m.ean} ×${m.vezes}  ${m.nome ? `${m.nome} [${m.marca || '?'}] (${pais})` : '(não está no off_full)'}`);
  }
}

const [dias] = await pool.query('SELECT DATE(em) dia, COUNT(*) n, SUM(hit) hits FROM base_local_evento GROUP BY dia ORDER BY dia DESC LIMIT 14');
console.log('\nPor dia:');
for (const d of dias) console.log(`  ${String(d.dia).slice(0, 10)}  ${String(d.n).padStart(4)} eventos · ${(d.hits / d.n * 100).toFixed(0)}% hit`);
await pool.end();

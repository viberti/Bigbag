// Materializa as FACETAS dos Mestres existentes como colunas (migração 043) —
// split puro da `chave`, sem LLM, instantâneo e idempotente.
//   node scripts/backfill_facetas.mjs
import { getPool } from '../src/db.js';
import { facetasDaChave, SLOTS } from '../src/normaliza/mestre.js';

const pool = getPool();
const [mestres] = await pool.query('SELECT id, chave FROM produto_mestre');
const cont = {};
for (const m of mestres) {
  const f = facetasDaChave(m.chave);
  await pool.query(
    `UPDATE produto_mestre SET apresentacao=?, corte=?, processamento=?, variedade=?, sabor=?, teor=?, estilo=?, funcao=?, fonte=? WHERE id=?`,
    [f.apresentacao, f.corte, f.processamento, f.variedade, f.sabor, f.teor, f.estilo, f.funcao, f.fonte, m.id],
  );
  for (const s of SLOTS) if (s !== 'categoria' && f[s]) cont[s] = (cont[s] || 0) + 1;
}
console.log(`Facetas materializadas em ${mestres.length} Mestres. Preenchimento por faceta:`);
for (const [s, n] of Object.entries(cont).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(14)} ${n}`);
process.exit(0);

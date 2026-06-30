// Limpa a nutrição IMPLAUSÍVEL da base_local (qualidade de dados, 2026-06-30).
// A base_local é materializada por SQL a partir do off_full/catálogo SEM passar pelo
// gate `nutricaoPlausivel` do fusor → entra lixo (kcal=8,84 num óleo, saturada>gordura,
// negativos…). Este backfill: MEDE (breakdown por código) e LIMPA (nutricao→NULL nas
// linhas impossíveis — "sem nota é melhor que nota errada"; o /info re-resolve no scan).
//
//   sudo -u dev node --env-file=.env scripts/limpar_nutricao_base_local.mjs --dry   # só medir
//   sudo -u dev node --env-file=.env scripts/limpar_nutricao_base_local.mjs          # medir + limpar
//
// Tripwire: aborta se for limpar >15% das linhas (sinal de bug, não de dados maus).
// Reutilizável: `build_base_local.mjs` importa `limparNutricaoBaseLocal` e corre-o no fim.
import { getPool, parseJsonCol } from '../src/db.js';
import { problemasNutricao } from '../src/normaliza/validadores.js';

export async function limparNutricaoBaseLocal(pool, { dry = false, tripwire = 0.15 } = {}) {
  const [rows] = await pool.query('SELECT ean, nutricao FROM base_local WHERE nutricao IS NOT NULL');
  const maus = [];
  const cont = {};
  for (const r of rows) {
    const n = parseJsonCol(r.nutricao);
    const probs = problemasNutricao(n);
    if (probs.length) {
      maus.push(r.ean);
      for (const c of probs) cont[c] = (cont[c] || 0) + 1;
    }
  }
  const pct = rows.length ? (100 * maus.length / rows.length) : 0;
  console.log(`[limpar_nut] base_local c/ nutrição: ${rows.length} · implausíveis: ${maus.length} (${pct.toFixed(1)}%)`);
  console.log('[limpar_nut] por código:', JSON.stringify(cont));
  if (dry) { console.log('[limpar_nut] --dry: nada alterado.'); return { total: rows.length, maus: maus.length, cont }; }
  if (!maus.length) { console.log('[limpar_nut] nada a limpar.'); return { total: rows.length, maus: 0, cont }; }
  if (pct > tripwire * 100) throw new Error(`TRIPWIRE: ${pct.toFixed(1)}% > ${tripwire * 100}% — recuso limpar (provável bug do validador)`);
  // limpa em lotes, numa transação
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < maus.length; i += 500) {
      const lote = maus.slice(i, i + 500);
      await conn.query('UPDATE base_local SET nutricao = NULL WHERE ean IN (?)', [lote]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  console.log(`[limpar_nut] LIMPO: ${maus.length} linhas → nutricao=NULL (transação OK).`);
  return { total: rows.length, maus: maus.length, cont };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes('--dry');
  const pool = getPool();
  limparNutricaoBaseLocal(pool, { dry })
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

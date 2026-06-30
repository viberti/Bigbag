// Materializa o Nutri-Score NUMÉRICO (nota 0–100) calculado por nós em base_local.ns_* (migr. 095),
// para AUDITORIA: ver inconsistências entre produtos iguais/similares num SELECT. CACHE regenerável —
// recalcula a partir de nutriScore()+família; idempotente; chamado também no fim do build_base_local.
//
//   sudo -u dev node --env-file=.env scripts/calcular_nutriscore_base_local.mjs          # recalcular
//   sudo -u dev node --env-file=.env scripts/calcular_nutriscore_base_local.mjs --auditar  # + relatório
import { getPool, parseJsonCol } from '../src/db.js';
import { familiaPorNome, classeNutriScore, acucarAssumivelZero } from '../src/normaliza/familia.js';
import { nutriScore } from '../src/normaliza/nutriscore.js';

export async function calcularNutriscoreBaseLocal(pool) {
  const [rows] = await pool.query('SELECT ean, nome, nutricao FROM base_local WHERE nutricao IS NOT NULL');
  const conn = await pool.getConnection();
  let comNota = 0, semNota = 0;
  try {
    await conn.beginTransaction();
    for (let i = 0; i < rows.length; i += 500) {
      const lote = rows.slice(i, i + 500);
      await Promise.all(lote.map((r) => {
        const n = parseJsonCol(r.nutricao);
        const familia = familiaPorNome(r.nome || '') || null;
        const classe = classeNutriScore(familia);
        const ns = nutriScore(n, { classe, acucarZero: acucarAssumivelZero(familia) });
        if (ns) comNota++; else semNota++;
        return conn.query(
          'UPDATE base_local SET ns_nota100=?, ns_grau=?, ns_pontos=?, ns_classe=?, ns_familia=? WHERE ean=?',
          [ns ? ns.nota100 : null, ns ? ns.grau : null, ns ? ns.pontos : null, ns ? classe : null, familia, r.ean],
        );
      }));
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  console.log(`[ns_calc] base_local: ${comNota} com nota, ${semNota} sem (nutrição insuficiente).`);
  return { comNota, semNota };
}

// Relatório de auditoria: famílias com maior DISPERSÃO de nota (potenciais inconsistências de dados).
async function auditar(pool) {
  const [fam] = await pool.query(
    `SELECT ns_familia, COUNT(*) n, MIN(ns_nota100) mn, MAX(ns_nota100) mx,
            ROUND(AVG(ns_nota100)) media, COUNT(DISTINCT ns_grau) graus
       FROM base_local WHERE ns_nota100 IS NOT NULL AND ns_familia IS NOT NULL
      GROUP BY ns_familia HAVING n >= 20 ORDER BY (mx-mn) DESC LIMIT 15`);
  console.log('\n[auditoria] famílias com MAIOR amplitude de nota (mín→máx) — candidatas a inconsistência:');
  for (const f of fam) console.log(`  ${String(f.ns_familia).padEnd(20)} n=${f.n}  nota ${f.mn}→${f.mx} (média ${f.media}, ${f.graus} graus diferentes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = getPool();
  calcularNutriscoreBaseLocal(pool)
    .then(() => (process.argv.includes('--auditar') ? auditar(pool) : null))
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

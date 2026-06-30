// Limpa nutrição por CONSENSO DE NOME (qualidade de dados, 2026-06-30): produtos com o MESMO
// nome devem ter nutrição parecida (ex.: "leite meio-gordo" ~48 kcal). Onde o grupo concorda
// (consenso APERTADO), uma linha grosseiramente fora é dado errado → anula-se (re-resolve no /info).
// Apanha o que o Atwater (energia alta vs macros) e o envelope-de-família (famílias heterogéneas)
// NÃO apanham. É GERAL (por nome, não por produto). Só age onde há consenso → precisão > recall.
//
//   sudo -u dev node --env-file=.env scripts/limpar_nutricao_consenso.mjs --dry   # medir
//   sudo -u dev node --env-file=.env scripts/limpar_nutricao_consenso.mjs          # medir + limpar
import { getPool, parseJsonCol } from '../src/db.js';

// Conservador de propósito (precisão > recall): kcal BAIXO pode ser variante light/zero LEGÍTIMA
// (refrigerante zero, iogurte magro) → NÃO se toca; só kcal ALTO num grupo MUITO apertado é erro
// (não se pode ter MAIS energia que a commodity — ex.: "leite meio-gordo" a 560 kcal = leite em pó/lixo).
const MIN_GRUPO = 4;        // nº mínimo de produtos com o mesmo nome p/ haver consenso
const FRAC_TIGHT = 0.8;     // consenso = ≥80% dentro de ±15% da mediana (commodity verdadeira, sem variantes)
const BANDA_TIGHT = 0.15;
const FATOR_OUT = 1.8;      // outlier = kcal > mediana×1,8 (SÓ ALTO; baixo pode ser light legítimo)

function mediana(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

export async function limparPorConsenso(pool, { dry = false, tripwire = 0.05 } = {}) {
  const [rows] = await pool.query('SELECT ean, nome, nutricao FROM base_local WHERE nutricao IS NOT NULL');
  const grupos = new Map();
  for (const r of rows) {
    const k = String(r.nome || '').trim().toLowerCase();
    if (!k) continue;
    const n = parseJsonCol(r.nutricao);
    const kcal = n && n.energia_kcal != null ? Number(n.energia_kcal) : null;
    (grupos.get(k) || grupos.set(k, []).get(k)).push({ ean: r.ean, kcal });
  }
  const maus = []; const exemplos = [];
  for (const [nome, membros] of grupos) {
    const comK = membros.filter((m) => Number.isFinite(m.kcal) && m.kcal > 0);
    if (comK.length < MIN_GRUPO) continue;
    const med = mediana(comK.map((m) => m.kcal));
    if (!med) continue;
    const tight = comK.filter((m) => Math.abs(m.kcal - med) <= BANDA_TIGHT * med);
    if (tight.length / comK.length < FRAC_TIGHT) continue; // grupo sem consenso (ex.: "chocolate") → não toca
    for (const m of comK) {
      if (m.kcal > med * FATOR_OUT) { // SÓ alto
        maus.push(m.ean);
        if (exemplos.length < 12) exemplos.push(`"${nome.slice(0, 30)}" mediana ${Math.round(med)} kcal → outlier ALTO ${m.kcal} (ean ${m.ean})`);
      }
    }
  }
  const pct = rows.length ? (100 * maus.length / rows.length) : 0;
  console.log(`[consenso] grupos de nome analisados: ${[...grupos.values()].filter((g) => g.length >= MIN_GRUPO).length}`);
  console.log(`[consenso] outliers de consenso: ${maus.length} (${pct.toFixed(2)}% do corpus)`);
  exemplos.forEach((e) => console.log('  ' + e));
  if (dry) { console.log('[consenso] --dry: nada alterado.'); return { maus: maus.length }; }
  if (!maus.length) return { maus: 0 };
  if (pct > tripwire * 100) throw new Error(`TRIPWIRE: ${pct.toFixed(2)}% > ${tripwire * 100}% — recuso limpar`);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < maus.length; i += 500) {
      const lote = maus.slice(i, i + 500);
      await conn.query('UPDATE base_local SET nutricao=NULL, ns_nota100=NULL, ns_grau=NULL, ns_pontos=NULL, ns_classe=NULL WHERE ean IN (?)', [lote]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  console.log(`[consenso] LIMPO: ${maus.length} linhas (nutrição + ns_* → NULL).`);
  return { maus: maus.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes('--dry');
  const pool = getPool();
  limparPorConsenso(pool, { dry }).then(() => pool.end()).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}

// B1 — backfill do GRUPO (categoria fechada) dos SKUs existentes. Fontes por
// força: food_groups do OFF (ficha de qualquer item do SKU) → categoria do SKU →
// categoria do produto_generico → nome canónico. Idempotente.
//   node scripts/backfill_grupos.mjs
import { getPool } from '../src/db.js';
import { grupoDe, GRUPO_OUTROS } from '../src/normaliza/categoria.js';

const pool = getPool();
const [skus] = await pool.query(`
  SELECT s.id, s.nome_canonico, s.categoria, pg.categoria AS cat_gen,
    (SELECT pe.off_json->'$.grupos_alimento' FROM item i JOIN produto_ean pe ON pe.ean = i.ean
      WHERE i.sku_id = s.id AND pe.off_json IS NOT NULL LIMIT 1) AS fg
  FROM sku_normalizado s LEFT JOIN produto_generico pg ON pg.sku_id = s.id`);

const dist = {};
let outros = 0;
const semGrupo = [];
for (const s of skus) {
  let foodGroups = null;
  try { foodGroups = s.fg ? (typeof s.fg === 'string' ? JSON.parse(s.fg) : s.fg) : null; } catch { /* */ }
  let g = grupoDe({ foodGroups, categoria: s.categoria, nome: s.nome_canonico });
  if (g === GRUPO_OUTROS && s.cat_gen) g = grupoDe({ categoria: s.cat_gen, nome: s.nome_canonico });
  await pool.query('UPDATE sku_normalizado SET grupo = ? WHERE id = ?', [g, s.id]);
  dist[g] = (dist[g] || 0) + 1;
  if (g === GRUPO_OUTROS) { outros++; if (semGrupo.length < 25) semGrupo.push(`${s.nome_canonico} (cat: ${s.categoria || '—'})`); }
}
console.log(`Backfill de grupo: ${skus.length} SKUs\n`);
for (const [g, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(12)} ${n}`);
console.log(`\n'outros' (${outros}) — amostra p/ curadoria:`);
for (const x of semGrupo) console.log('  · ' + x);
process.exit(0);

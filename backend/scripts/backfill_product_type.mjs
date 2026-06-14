// BACKFILL do product_type (ALIMENTO vs NÃO-ALIMENTO) no catálogo (Fase 2).
// Classificador determinístico (src/normaliza/tipoProduto.js) por linha, usando
// nome(_pt), nutrição, categoria + categoria_path (hierarquia) e — para os EANs —
// os grupos_alimento do OFF. Aditivo/idempotente; corre por cursor de id.
//   sudo -u dev node --env-file=.env scripts/backfill_product_type.mjs
import { getPool, parseJsonCol } from '../src/db.js';
import { tipoProduto } from '../src/normaliza/tipoProduto.js';

const pool = getPool();
const BATCH = 2000;
let cursor = 0, total = 0, food = 0, non = 0, nul = 0;
const t0 = Date.now();

for (;;) {
  const [rows] = await pool.query(
    `SELECT cp.id, cp.nome, cp.nome_pt, cp.categoria, cp.categoria_path, cp.nutricao, op.grupos_alimento
       FROM catalogo_produto cp
       LEFT JOIN off_produto op ON op.ean = cp.ean COLLATE utf8mb4_0900_ai_ci
      WHERE cp.id > ? ORDER BY cp.id LIMIT ?`, [cursor, BATCH]);
  if (!rows.length) break;
  const foodIds = [], nonIds = [];
  for (const r of rows) {
    const nut = parseJsonCol(r.nutricao);
    const temNut = !!(nut && typeof nut === 'object' && Object.values(nut).some((v) => v != null));
    const t = tipoProduto({
      nome: r.nome_pt || r.nome,
      temNutricao: temNut,
      foodGroups: parseJsonCol(r.grupos_alimento) ?? r.grupos_alimento,
      categoria: [r.categoria, r.categoria_path].filter(Boolean).join(' '),
    });
    if (t === 'food') { food++; foodIds.push(r.id); }
    else if (t === 'non_food') { non++; nonIds.push(r.id); }
    else nul++;
    total++;
  }
  // 2 UPDATEs por lote (os NULL ficam como estão); idempotente
  if (foodIds.length) await pool.query(`UPDATE catalogo_produto SET product_type='food' WHERE id IN (${foodIds.map(() => '?').join(',')})`, foodIds);
  if (nonIds.length) await pool.query(`UPDATE catalogo_produto SET product_type='non_food' WHERE id IN (${nonIds.map(() => '?').join(',')})`, nonIds);
  cursor = rows[rows.length - 1].id;
  const rps = (total / ((Date.now() - t0) / 1000)).toFixed(0);
  console.error(`  …${total} · food ${food} · non_food ${non} · null ${nul} · ${rps}/s · cursor ${cursor}`);
}
console.log(`\n✅ product_type: ${total} classificados — food ${food}, non_food ${non}, null(ambíguo) ${nul}.`);
const [[c]] = await pool.query("SELECT product_type, COUNT(*) n FROM catalogo_produto GROUP BY product_type");
await pool.end();
process.exit(0);

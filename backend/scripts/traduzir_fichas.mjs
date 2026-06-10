// Traduz para PT-BR as fichas do banco de EANs que vieram noutra língua do
// Open Food Facts (nome/ingredientes/alergénios). O LLM deteta e só mexe no que
// não está em português; marcas ficam intactas; o off_json original não muda.
// Idempotente (já-PT → mudou=false). Serial, para não martelar o OpenRouter.
//   node scripts/traduzir_fichas.mjs
import { getPool } from '../src/db.js';
import { garantirFichaPT } from '../src/ingest/traduz.js';

const pool = getPool();
const [rows] = await pool.query(
  "SELECT DISTINCT ean, nome FROM produto_ean WHERE ean IS NOT NULL AND ean <> '' AND (nome IS NOT NULL OR ingredientes IS NOT NULL)",
);
console.log(`${rows.length} ficha(s) a verificar…`);
let mudadas = 0;
for (const r of rows) {
  const antes = r.nome;
  const mudou = await garantirFichaPT(pool, r.ean);
  if (mudou) {
    mudadas++;
    const [[d]] = await pool.query('SELECT nome FROM produto_ean WHERE ean = ?', [r.ean]);
    console.log(`  ✓ ${r.ean}: ${antes} → ${d?.nome}`);
  }
}
console.log(`Traduzidas: ${mudadas}/${rows.length}.`);
await pool.end();

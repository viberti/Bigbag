// Backfill: calcula preco_por_base para itens já gravados (a partir da
// descricao_original + preco_liquido + quantidade). Idempotente. Correr uma vez
// após introduzir a Camada 1 da normalização.
//   node scripts/backfill_preco_por_base.mjs
import { getPool, closePool } from '../src/db.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';

const pool = getPool();
const [itens] = await pool.query(
  'SELECT id, descricao_original, preco_liquido, quantidade FROM item WHERE is_non_product = FALSE',
);

let atualizados = 0;
for (const it of itens) {
  const f = extrairFormato(it.descricao_original);
  const ppb = precoPorBase({ preco_liquido: it.preco_liquido, quantidade: it.quantidade }, f);
  if (ppb != null) {
    await pool.query('UPDATE item SET preco_por_base = ? WHERE id = ?', [ppb, it.id]);
    atualizados++;
  }
}
console.log(`Backfill: ${atualizados}/${itens.length} itens com preco_por_base.`);
await closePool();

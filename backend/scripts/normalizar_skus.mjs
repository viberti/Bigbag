// Normaliza os itens ainda sem SKU: para cada descrição distinta, resolve o
// sku_normalizado (alias → LLM → criar/emparelhar) e liga todos os itens com
// essa descrição. Idempotente (a cache de aliases evita reprocessar).
//   node scripts/normalizar_skus.mjs
import { getPool, closePool } from '../src/db.js';
import { resolverSku } from '../src/normaliza/matcher.js';

const pool = getPool();
const [rows] = await pool.query(
  'SELECT DISTINCT descricao_original FROM item WHERE sku_id IS NULL AND is_non_product = FALSE ORDER BY descricao_original',
);

const cont = { novo: 0, match: 0, alias: 0, revisao: 0, erro: 0 };
for (const { descricao_original } of rows) {
  try {
    const r = await resolverSku(pool, descricao_original);
    if (r.sku_id) {
      await pool.query('UPDATE item SET sku_id = ? WHERE descricao_original = ? AND sku_id IS NULL', [
        r.sku_id,
        descricao_original,
      ]);
    }
    cont[r.via] = (cont[r.via] || 0) + 1;
    const nome = r.canonical ? `→ ${r.canonical.nome_canonico}${r.canonical.marca ? ' · ' + r.canonical.marca : ''}` : '';
    console.log(`${String(r.via).padEnd(7)} ${descricao_original.slice(0, 34).padEnd(34)} ${nome}`);
  } catch (e) {
    cont.erro++;
    console.error('ERRO   ', descricao_original, '-', e.message);
  }
}
console.log(`\nResumo: ${cont.novo} novos SKU · ${cont.match} match · ${cont.alias} alias · ${cont.revisao} revisão · ${cont.erro} erro`);
await closePool();

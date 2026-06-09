// Carimba item.ean nas linhas SEM EAN cujo nome de talão liga a UM ÚNICO EAN
// conhecido (produto_nome). Identidade forte: nome idêntico → mesmo produto, logo
// o EAN é seguro de gravar na linha. Exclui não-produtos e frescos (não têm/precisam
// de EAN). Idempotente — re-corre depois de novas identificações.
//   node scripts/carimbar_ean.mjs
import { getPool } from '../src/db.js';

async function main() {
  const pool = getPool();
  const [r] = await pool.query(`
    UPDATE item i
    JOIN (
      SELECT pn.nome, MIN(pn.ean) AS ean
        FROM produto_nome pn
       WHERE pn.ean IS NOT NULL
       GROUP BY pn.nome
      HAVING COUNT(DISTINCT pn.ean) = 1
    ) m ON m.nome = i.descricao_original
    LEFT JOIN produto_generico pg ON pg.sku_id = i.sku_id
       SET i.ean = m.ean
     WHERE i.ean IS NULL AND i.is_non_product = 0 AND (pg.tipo IS NULL OR pg.tipo <> 'fresco')`);
  console.log(`Carimbados ${r.affectedRows} item(s) com o EAN conhecido pelo nome.`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

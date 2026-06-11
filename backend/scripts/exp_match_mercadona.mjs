// EXPERIÊNCIA: matching dos itens de talão MERCADONA (worklist sem EAN) contra o
// catálogo. Reporta, por item, o melhor candidato e a FONTE — para comparar
// ANTES vs DEPOIS de traduzir o catálogo Mercadona para PT (nome_pt).
//   node scripts/exp_match_mercadona.mjs
import { getPool } from '../src/db.js';
import { buscarCatalogo } from '../src/normaliza/resolverProduto.js';

const pool = getPool();
const [itens] = await pool.query(`
  SELECT i.descricao_original AS d, MAX(COALESCE(l.cadeia, l.nome)) AS cadeia
    FROM item i JOIN fatura f ON f.id = i.fatura_id JOIN loja l ON l.id = f.loja_id
    LEFT JOIN produto_generico pg ON pg.sku_id = i.sku_id
   WHERE i.is_non_product = 0 AND i.ean IS NULL AND (pg.tipo IS NULL OR pg.tipo <> 'fresco')
     AND COALESCE(l.cadeia, l.nome) = 'Mercadona'
     AND NOT EXISTS (SELECT 1 FROM produto_ean pe JOIN item i2 ON i2.id = pe.item_id
                      WHERE i2.descricao_original = i.descricao_original AND pe.ean IS NOT NULL)
   GROUP BY i.descricao_original ORDER BY d`);

let comEan = 0, naMercadona = 0;
for (const it of itens) {
  const r = await buscarCatalogo(pool, it.d, { cadeia: 'Mercadona', limiar: 0.55 });
  if (r?.ean) {
    comEan++;
    if (r.fonte === 'mercadona') naMercadona++;
    const tag = r.fonte === 'mercadona' ? '🟢' : '  ';
    console.log(`${tag} ${it.d.padEnd(30)} → ${r.score}/${r.fonte.padEnd(10)} ${r.nome.slice(0, 48)}`);
  } else {
    console.log(`   ${it.d.padEnd(30)} → ${r ? '(sem EAN: ' + r.nome.slice(0, 30) + ')' : '(sem match)'}`);
  }
}
console.log(`\n${itens.length} itens · com EAN: ${comEan} · NA PRÓPRIA cadeia (mercadona): ${naMercadona}`);
process.exit(0);

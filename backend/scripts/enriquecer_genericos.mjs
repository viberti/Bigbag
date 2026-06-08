// Classifica cada SKU canónico (fresco vs. embalado) e guarda a nutrição típica
// dos frescos em produto_generico — pelo NOME, sem precisar de EAN. Idempotente:
// só processa SKUs ainda não caracterizados. Corre no servidor (usa LLM).
//   node --env-file=.env scripts/enriquecer_genericos.mjs
import { getPool } from '../src/db.js';
import { caracterizarProdutoNome } from '../src/ingest/produto.js';

const pool = getPool();
// SKUs usados em itens (produto real), ainda sem caracterização.
const [skus] = await pool.query(`
  SELECT s.id, s.nome_canonico AS nome
    FROM sku_normalizado s
   WHERE EXISTS (SELECT 1 FROM item i WHERE i.sku_id = s.id AND i.is_non_product = 0)
     AND NOT EXISTS (SELECT 1 FROM produto_generico g WHERE g.sku_id = s.id)
   ORDER BY s.id`);

console.log(`SKUs a caracterizar: ${skus.length}`);
let nFresco = 0, nProc = 0, custo = 0, erros = 0;
for (const s of skus) {
  try {
    const { dados, custo: c } = await caracterizarProdutoNome(s.nome);
    custo += c || 0;
    const tipo = dados.tipo === 'fresco' ? 'fresco' : 'processado';
    await pool.query(
      'INSERT INTO produto_generico (sku_id, tipo, alimento, categoria, nutricao, modelo) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE tipo=VALUES(tipo), alimento=VALUES(alimento), categoria=VALUES(categoria), nutricao=VALUES(nutricao), modelo=VALUES(modelo)',
      [s.id, tipo, dados.alimento || null, dados.categoria || null, dados.nutricao_100g ? JSON.stringify(dados.nutricao_100g) : null, 'modelConsulta'],
    );
    if (tipo === 'fresco') { nFresco++; console.log(`  fresco: ${s.nome} (${dados.nutricao_100g?.energia_kcal ?? '?'} kcal/100g)`); }
    else nProc++;
  } catch (e) {
    erros++;
    console.error(`  ERRO sku ${s.id} "${s.nome}": ${e.message}`);
  }
}
console.log(`\nFeito: ${nFresco} frescos, ${nProc} embalados, ${erros} erros. Custo ~$${custo.toFixed(4)}.`);
process.exit(0);

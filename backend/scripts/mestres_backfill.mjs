// Backfill NÃO-destrutivo: para cada SKU existente, classifica a sua descrição
// representativa no Produto Mestre (limpeza → facetas → chave) e liga (mestre_id).
// Não funde nem apaga SKUs — apenas agrupa por cima. Re-corrível (idempotente).
import { getPool } from '../src/db.js';
import { classificarMestre } from '../src/normaliza/classificaMestre.js';

const db = getPool();
const [skus] = await db.query(
  `SELECT s.id, s.nome_canonico,
          (SELECT i.descricao_original FROM item i
             WHERE i.sku_id = s.id AND i.is_non_product = 0
             GROUP BY i.descricao_original ORDER BY COUNT(*) DESC LIMIT 1) AS desc_rep
     FROM sku_normalizado s
    WHERE EXISTS (SELECT 1 FROM item i WHERE i.sku_id = s.id AND i.is_non_product = 0)`,
);
console.log('SKUs a classificar:', skus.length);

let ok = 0, err = 0;
const porChave = new Map(); // chave -> [{id,nome}]
for (const s of skus) {
  if (!s.desc_rep) { err++; continue; }
  try {
    const { chave, categoria } = await classificarMestre(s.desc_rep);
    const [r] = await db.query(
      'INSERT INTO produto_mestre (chave, categoria, nome) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
      [chave, categoria || null, s.nome_canonico],
    );
    await db.query('UPDATE sku_normalizado SET mestre_id = ? WHERE id = ?', [r.insertId, s.id]);
    (porChave.get(chave) || porChave.set(chave, []).get(chave)).push({ id: s.id, nome: s.nome_canonico });
    ok++;
  } catch (e) {
    err++;
  }
  if ((ok + err) % 25 === 0) process.stdout.write('.');
}
process.stdout.write('\n');

// de-fragmentação: chaves com ≥2 SKUs antigos
const defrag = [...porChave.entries()].filter(([, v]) => v.length >= 2);
const [[tot]] = await db.query('SELECT COUNT(*) n FROM produto_mestre');
console.log('\n=== BACKFILL ===');
console.log('classificados:', ok, '| erros:', err, '| Mestres criados:', tot.n);
console.log('Mestres que reúnem ≥2 SKUs antigos (de-fragmentação):', defrag.length);
for (const [chave, v] of defrag.slice(0, 40)) {
  console.log('  ▸ ' + chave);
  for (const x of v) console.log('      #' + x.id + ' ' + x.nome);
}
await db.end();

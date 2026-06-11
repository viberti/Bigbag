// Backfill NÃO-destrutivo: para cada SKU existente, classifica a sua descrição
// representativa no Produto Mestre (limpeza → facetas → chave) e liga (mestre_id).
// Não funde nem apaga SKUs — apenas agrupa por cima. Re-corrível (idempotente).
import { getPool } from '../src/db.js';
import { classificarMestre } from '../src/normaliza/classificaMestre.js';
import { facetasDaChave } from '../src/normaliza/mestre.js';

const db = getPool();

// Limpeza/auto-cura: desfaz qualquer Mestre DEGENERADO (categoria vazia → chave a
// começar por "|"), que agruparia produtos sem nada a ver. Idempotente.
await db.query("UPDATE sku_normalizado SET mestre_id = NULL WHERE mestre_id IN (SELECT id FROM produto_mestre WHERE chave LIKE '|%')");
await db.query("DELETE FROM produto_mestre WHERE chave LIKE '|%'");

const [skus] = await db.query(
  `SELECT s.id, s.nome_canonico,
          (SELECT i.descricao_original FROM item i
             WHERE i.sku_id = s.id AND i.is_non_product = 0
             GROUP BY i.descricao_original ORDER BY COUNT(*) DESC LIMIT 1) AS desc_rep
     FROM sku_normalizado s
    WHERE EXISTS (SELECT 1 FROM item i WHERE i.sku_id = s.id AND i.is_non_product = 0)`,
);
console.log('SKUs a classificar:', skus.length);

let ok = 0, err = 0, semCat = 0;
const porChave = new Map(); // chave -> [{id,nome}]
for (const s of skus) {
  if (!s.desc_rep) { err++; continue; }
  try {
    const { chave, categoria } = await classificarMestre(s.desc_rep);
    // Categoria é o portão-MESTRE: sem ela, NÃO agrupa (senão colapsa tudo num
    // Mestre-lixo). Fica sem mestre_id — não-classificado, candidato a revisão.
    if (!categoria) { semCat++; continue; }
    // facetas como COLUNAS (migração 043) — derivadas da própria chave
    const fc = facetasDaChave(chave);
    const [r] = await db.query(
      `INSERT INTO produto_mestre (chave, categoria, apresentacao, corte, processamento, variedade, sabor, teor, estilo, funcao, fonte, nome)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), apresentacao=VALUES(apresentacao), corte=VALUES(corte),
         processamento=VALUES(processamento), variedade=VALUES(variedade), sabor=VALUES(sabor), teor=VALUES(teor),
         estilo=VALUES(estilo), funcao=VALUES(funcao), fonte=VALUES(fonte)`,
      [chave, categoria || null, fc.apresentacao, fc.corte, fc.processamento, fc.variedade, fc.sabor, fc.teor, fc.estilo, fc.funcao, fc.fonte, s.nome_canonico],
    );
    await db.query('UPDATE sku_normalizado SET mestre_id = ? WHERE id = ?', [r.insertId, s.id]);
    (porChave.get(chave) || porChave.set(chave, []).get(chave)).push({ id: s.id, nome: s.nome_canonico });
    ok++;
  } catch (e) {
    err++;
  }
  if ((ok + err + semCat) % 25 === 0) process.stdout.write('.');
}
process.stdout.write('\n');

// auto-limpeza: apaga Mestres órfãos (sem nenhum SKU a apontar) — ex. sobras de
// re-runs anteriores cuja chave mudou. Mantém a tabela só com Mestres reais.
await db.query('DELETE m FROM produto_mestre m WHERE NOT EXISTS (SELECT 1 FROM sku_normalizado s WHERE s.mestre_id = m.id)');

// de-fragmentação: chaves com ≥2 SKUs antigos
const defrag = [...porChave.entries()].filter(([, v]) => v.length >= 2);
const [[tot]] = await db.query('SELECT COUNT(*) n FROM produto_mestre');
console.log('\n=== BACKFILL ===');
console.log('classificados:', ok, '| sem categoria (não ligados):', semCat, '| erros:', err, '| Mestres criados:', tot.n);
console.log('Mestres que reúnem ≥2 SKUs antigos (de-fragmentação):', defrag.length);
for (const [chave, v] of defrag.slice(0, 40)) {
  console.log('  ▸ ' + chave);
  for (const x of v) console.log('      #' + x.id + ' ' + x.nome);
}
await db.end();

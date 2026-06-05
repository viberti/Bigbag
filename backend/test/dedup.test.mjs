// Deduplicação de faturas. persistirFatura faz commit próprio, por isso o teste
// usa uma loja-sentinela (nif ZZDEDUP) e datas em 2088 (fora do range dos
// outros testes) e limpa tudo no fim.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { persistirFatura } from '../src/ingest/persist.js';

const pool = getPool();
const dados = {
  loja: { cadeia: 'Continente', nome: 'ZZDEDUP Loja', nif: 'ZZDEDUP' },
  numero_fatura: 'FS ZZDEDUP/0001',
  data_compra: '2088-03-03T10:00:00',
  total_impresso: 12.34,
  desconto_global: 0,
  itens: [{ descricao_original: 'ZZDEDUP ITEM', preco_unitario: 12.34, preco_liquido: 12.34, is_non_product: true }],
};

after(async () => {
  await pool.query("DELETE FROM fatura WHERE loja_id IN (SELECT id FROM loja WHERE nif='ZZDEDUP')");
  await pool.query("DELETE FROM loja WHERE nif='ZZDEDUP'");
  await closePool();
});

test('1ª inserção grava; 2ª é detetada como duplicada (mesmo nº)', async () => {
  const r1 = await persistirFatura(pool, dados, { metodo: 'vlm', totalReconciliado: 12.34 });
  assert.ok(r1.fatura_id > 0 && !r1.duplicada);
  const r2 = await persistirFatura(pool, dados, { metodo: 'vlm', totalReconciliado: 12.34 });
  assert.equal(r2.duplicada, true);
  assert.equal(r2.fatura_id, r1.fatura_id);
});

test('sem número, dedup por loja+data+total apanha na mesma', async () => {
  const semNum = { ...dados, numero_fatura: null };
  const r = await persistirFatura(pool, semNum, { metodo: 'vlm', totalReconciliado: 12.34 });
  assert.equal(r.duplicada, true); // já existe da 1ª inserção (mesma data+total)
});

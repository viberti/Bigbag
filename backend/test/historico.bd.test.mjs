// Memória da conversa: guardar e carregar por ordem cronológica.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { guardarMensagem, carregarHistorico } from '../src/historico.js';

const pool = getPool();
const U = 'ZZHIST';

after(async () => {
  await pool.query('DELETE FROM mensagem WHERE utilizador = ?', [U]);
  await closePool();
});

test('guarda e carrega o histórico do utilizador (cronológico)', async () => {
  await guardarMensagem(U, 'user', 'quanto gastei em maio?');
  await guardarMensagem(U, 'assistant', 'Gastaste 275,72 €.');
  await guardarMensagem(U, 'user', 'e no Lidl?');
  const h = await carregarHistorico(U, { limite: 10 });
  assert.equal(h.length, 3);
  assert.equal(h[0].role, 'user');
  assert.equal(h[0].content, 'quanto gastei em maio?');
  assert.equal(h[1].role, 'assistant');
  assert.equal(h[2].content, 'e no Lidl?');
});

test('o limite traz só as mais recentes', async () => {
  const h = await carregarHistorico(U, { limite: 2 });
  assert.equal(h.length, 2);
  assert.equal(h[1].content, 'e no Lidl?'); // a última
});

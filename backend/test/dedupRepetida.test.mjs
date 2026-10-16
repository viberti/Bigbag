// Rede 2 da dedup (persist.js): compra REPETIDA do mesmo cabaz não pode ser apagada como duplicado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatoPodeSerDuplicado as pode } from '../src/ingest/persist.js';

test('mesmo cabaz duas semanas depois NÃO é duplicado', () => {
  assert.equal(pode({ numero: null, data: '2026-10-14' }, { numero_fatura: null, data_compra: '2026-09-30' }), false);
});
test('números de documento diferentes = compras diferentes', () => {
  assert.equal(pode({ numero: 'FS 1/100', data: '2026-10-14' }, { numero_fatura: 'FS 1/101', data_compra: '2026-10-14' }), false);
});
test('o mesmo talão lido duas vezes (data mal lida por 1 dia, sem nº) continua a ser duplicado', () => {
  assert.equal(pode({ numero: null, data: '2026-10-15' }, { numero_fatura: null, data_compra: '2026-10-14' }), true);
  assert.equal(pode({ numero: 'FS 1/100', data: '2026-10-14' }, { numero_fatura: 'FS 1/100', data_compra: '2026-10-14' }), true);
});
test('sem data num dos lados: decide só o nº (se houver)', () => {
  assert.equal(pode({ numero: null, data: null }, { numero_fatura: null, data_compra: '2026-01-01' }), true);
});

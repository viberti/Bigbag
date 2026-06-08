import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eanValido } from '../src/ingest/produto.js';

test('EAN-13 válidos passam', () => {
  assert.equal(eanValido('4056489219781'), true); // molho de soja (no OFF)
  assert.equal(eanValido('5602384002813'), true); // queijo para barrar
});

test('EAN com dígito verificador errado é rejeitado', () => {
  assert.equal(eanValido('2056489219781'), false); // 1.º dígito mal lido (4→2)
  assert.equal(eanValido('5602384002814'), false); // último dígito alterado
});

test('comprimentos/entradas inválidas', () => {
  assert.equal(eanValido('123'), false);
  assert.equal(eanValido(''), false);
  assert.equal(eanValido(null), false);
  assert.equal(eanValido(undefined), false);
});

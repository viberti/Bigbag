import { test } from 'node:test';
import assert from 'node:assert';
import { precoValido } from '../src/normaliza/precoValido.js';

test('sentinelas exatas → inválido', () => {
  for (const s of [99999, 999999, 9999999]) assert.equal(precoValido(s), false);
});
test('caros legítimos → válido (não filtrar por faixa)', () => {
  assert.ok(precoValido(558855.19));
  assert.ok(precoValido(99998));     // logo abaixo do sentinela
  assert.ok(precoValido(100000));    // logo acima
});
test('piso de centavo (<0,50)', () => {
  assert.equal(precoValido(0.01), false);
  assert.equal(precoValido(0.49), false);
  assert.ok(precoValido(0.5));
  assert.ok(precoValido(1.5));
});
test('zero / negativo / não-número → inválido', () => {
  for (const v of [0, -5, null, undefined, NaN, 'x']) assert.equal(precoValido(v), false);
});
test('disponibilidade (VTEX)', () => {
  assert.equal(precoValido(50, { disponivel: false }), false);
  assert.ok(precoValido(50, { disponivel: true }));
  assert.ok(precoValido(50));        // sem info de disponibilidade = não bloqueia
});

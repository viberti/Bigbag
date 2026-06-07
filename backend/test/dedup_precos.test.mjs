import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sobreposicaoPrecos } from '../src/ingest/persist.js';

test('preços idênticos → sobreposição total', () => {
  assert.equal(sobreposicaoPrecos([2.55, 2.91, 1.39], [1.39, 2.91, 2.55]), 3);
});
test('tolera cêntimos de OCR (2,55 ≈ 2,56)', () => {
  // par real #197/#198: AMENDOIM 2,55/2,56 e MAMÃO 1,81/1,89 (este último >0,02 não casa)
  assert.equal(sobreposicaoPrecos([2.55, 2.91, 5.16], [2.56, 2.91, 5.16]), 3);
});
test('diferença grande NÃO casa (1,81 vs 1,89)', () => {
  assert.equal(sobreposicaoPrecos([1.81], [1.89]), 0);
});
test('cada preço consome no máximo um (multiconjunto)', () => {
  assert.equal(sobreposicaoPrecos([2.0, 2.0, 2.0], [2.0, 2.0]), 2);
});
test('cestas diferentes → baixa sobreposição', () => {
  assert.equal(sobreposicaoPrecos([1.0, 2.0, 3.0], [9.0, 8.0, 7.0]), 0);
});

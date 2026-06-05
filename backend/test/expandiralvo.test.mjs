import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandirAlvo } from '../src/queries.js';

test('"bebida alcoólica" expande para vinho/cerveja/garrafeira…', () => {
  const t = expandirAlvo('bebida alcoólica');
  for (const x of ['vinho', 'cerveja', 'garrafeira']) assert.ok(t.includes(x), `falta ${x}`);
});

test('"álcool" também expande', () => {
  assert.ok(expandirAlvo('álcool').includes('vinho'));
});

test('produto literal não é expandido', () => {
  assert.deepEqual(expandirAlvo('vinho'), ['vinho']);
  assert.deepEqual(expandirAlvo('leite meio gordo'), ['leite meio gordo']);
});

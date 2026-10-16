import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listaDe } from '../src/listaId.js';

const req = (hdr, query = {}) => ({ get: (h) => (h === 'X-Lista' ? hdr : undefined), query });

test('listaDe: sem header nem query → bigbag (contrato do BigBag intacto)', () => {
  assert.equal(listaDe(req(undefined)), 'bigbag');
  assert.equal(listaDe(undefined), 'bigbag');
});
test('listaDe: header da app Lista → simples (case-insensitive)', () => {
  assert.equal(listaDe(req('simples')), 'simples');
  assert.equal(listaDe(req(' SIMPLES '), {}), 'simples');
});
test('listaDe: query ?lista= também serve', () => {
  assert.equal(listaDe(req(undefined, { lista: 'simples' })), 'simples');
});
test('listaDe: valor desconhecido → bigbag (não cria listas)', () => {
  assert.equal(listaDe(req("x'; DROP TABLE")), 'bigbag');
  assert.equal(listaDe(req('outra')), 'bigbag');
});

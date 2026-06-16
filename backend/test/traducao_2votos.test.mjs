import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traducoesConcordam, consensoTraducao } from '../src/ingest/traduz.js';

test('grafias da denominação concordam (Muçarela/Mussarela) — mesmo produto', () => {
  assert.equal(traducoesConcordam('Muçarela Queijo em Fatias', 'Mussarela Queijo em Fatias'), true);
});

test('troca de TIPO NÃO concorda (Queijo vs Ovo) — apanha a alucinação', () => {
  assert.equal(traducoesConcordam('Ovo de Mozzarella em Fatias', 'Mussarela Queijo em Fatias'), false);
});

test('consenso isola a alucinação (Ovo) entre 3 votos', () => {
  const r = consensoTraducao(['Ovo de Mozzarella em Fatias', 'Mussarela Queijo em Fatias', 'Muçarela Queijo Fatias']);
  assert.match(r, /Queijo/);
  assert.doesNotMatch(r, /Ovo/);
});

test('todos concordam → fica o 1.º', () => {
  assert.equal(consensoTraducao(['Mussarela Queijo em Fatias', 'Muçarela Queijo Fatias']), 'Mussarela Queijo em Fatias');
});

test('1 só candidato ou vazios → devolve o que há (sem rebentar)', () => {
  assert.equal(consensoTraducao(['Queijo Fatiado']), 'Queijo Fatiado');
  assert.equal(consensoTraducao([null, undefined]), null);
});

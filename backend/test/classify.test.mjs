import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarLoja } from '../src/ingest/classify.js';

test('cadeias de supermercado conhecidas', () => {
  assert.equal(classificarLoja({ cadeia: 'Continente', nome: 'Continente Braga' }), 'supermercado');
  assert.equal(classificarLoja({ cadeia: 'Mercadona', nome: 'IRMADONA SUPERMERCADOS' }), 'supermercado');
  assert.equal(classificarLoja({ cadeia: 'Pingo Doce', nome: 'Pingo Doce X' }), 'supermercado');
});

test('supermercado detetado pelo nome quando a cadeia falha', () => {
  assert.equal(classificarLoja({ cadeia: 'Desconhecida', nome: 'LIDL & CIA' }), 'supermercado');
});

test('farmácia pelo nome', () => {
  assert.equal(classificarLoja({ cadeia: 'Desconhecida', nome: 'FARMACIA DE LAMAÇAES' }), 'farmacia');
  assert.equal(classificarLoja({ cadeia: 'Desconhecida', nome: 'Farmácia Central' }), 'farmacia');
});

test('resto fica outro', () => {
  assert.equal(classificarLoja({ cadeia: 'Primor', nome: 'Nova Arcada' }), 'outro');
  assert.equal(classificarLoja({}), 'outro');
});

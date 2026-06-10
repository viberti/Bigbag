import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casaNomeLista } from '../src/ingest/reconciliarLista.js';

test('subset: "Leite" da lista casa com "Leite Meio Gordo" comprado', () => {
  assert.equal(casaNomeLista('Leite', ['Leite Meio Gordo']), true);
});

test('nome completo casa com canónico igual', () => {
  assert.equal(casaNomeLista('Leite Meio Gordo', ['Leite Meio Gordo']), true);
});

test('plural tolera: "Bananas" casa "Banana" (e vice-versa)', () => {
  assert.equal(casaNomeLista('Bananas', ['Banana']), true);
  assert.equal(casaNomeLista('Banana', ['Bananas']), true);
});

test('acentos PT-BR vs PT: "Papel higiênico" casa "Papel Higiénico 4 Folhas"', () => {
  assert.equal(casaNomeLista('Papel higiênico', ['Papel Higiénico 4 Folhas']), true);
});

test('conservador: token a mais na lista NÃO casa', () => {
  assert.equal(casaNomeLista('Queijo fresco', ['Queijo']), false);
  assert.equal(casaNomeLista('Detergente roupa', ['Detergente loiça máquina']), false);
});

test('casa pela descrição crua do talão quando não há canónico', () => {
  assert.equal(casaNomeLista('Ovos', [null, null, 'OVOS M CLASSE A 12UN']), true);
});

test('vazio/só stopwords não casa nada', () => {
  assert.equal(casaNomeLista('', ['Leite']), false);
  assert.equal(casaNomeLista('de e com', ['Leite']), false);
});

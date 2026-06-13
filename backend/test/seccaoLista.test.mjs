import test from 'node:test';
import assert from 'node:assert/strict';
import { seccaoLista, SECCOES_LISTA } from '../src/normaliza/categoria.js';

test('grupos diretos → secção', () => {
  assert.equal(seccaoLista('frutas', 'Banana'), 'frutas');
  assert.equal(seccaoLista('peixe', 'Atum em Lata'), 'peixe');
  assert.equal(seccaoLista('lacticinios', 'Queijo Flamengo'), 'laticinios'); // queijo → laticínios
  assert.equal(seccaoLista('lacticinios', 'Iogurte Natural'), 'laticinios');
  assert.equal(seccaoLista('padaria', 'Pão de Forma'), 'padaria');
  assert.equal(seccaoLista('congelados', 'Pizza Congelada'), 'congelados');
  assert.equal(seccaoLista('bebidas', 'Vinho Tinto Douro'), 'bebidas');
  assert.equal(seccaoLista('doces', 'Chocolate de Leite'), 'doces');
  assert.equal(seccaoLista('higiene', 'Detergente Roupa'), 'higiene');
});

test('carne → charcutaria (curados) vs carne (fresco)', () => {
  assert.equal(seccaoLista('carne', 'Fiambre da Perna'), 'charcutaria');
  assert.equal(seccaoLista('carne', 'Chouriço de Carne'), 'charcutaria');
  assert.equal(seccaoLista('carne', 'Presunto Pata Negra'), 'charcutaria');
  assert.equal(seccaoLista('carne', 'Peito de Frango'), 'carne');
  assert.equal(seccaoLista('carne', 'Bife do Lombo'), 'carne');
});

test('mercearia → café-chá / condimentos / mercearia', () => {
  assert.equal(seccaoLista('mercearia', 'Café Solúvel Descafeinado'), 'cafe_cha');
  assert.equal(seccaoLista('mercearia', 'Chá Verde'), 'cafe_cha');
  assert.equal(seccaoLista('mercearia', 'Infusão Camomila'), 'cafe_cha');
  assert.equal(seccaoLista('mercearia', 'Azeite Virgem Extra'), 'condimentos');
  assert.equal(seccaoLista('mercearia', 'Molho Bolonhesa'), 'condimentos');
  assert.equal(seccaoLista('mercearia', 'Sal Fino'), 'condimentos');
  assert.equal(seccaoLista('mercearia', 'Massa Penne Rigate'), 'mercearia');
  assert.equal(seccaoLista('mercearia', 'Arroz Basmati'), 'mercearia');
  assert.equal(seccaoLista('mercearia', 'Atum em Conserva'), 'mercearia'); // conserva = mercearia (grupo já é peixe se "atum" sozinho; aqui forçado mercearia)
});

test('outros e cobertura das 13', () => {
  assert.equal(seccaoLista('outros', 'Vela Perfumada'), 'outros');
  // toda a saída ∈ SECCOES_LISTA
  for (const [g, n] of [['frutas', 'Maçã'], ['carne', 'Fiambre'], ['mercearia', 'Café'], ['mercearia', 'Azeite'], ['mercearia', 'Arroz']])
    assert.ok(SECCOES_LISTA.includes(seccaoLista(g, n)));
});

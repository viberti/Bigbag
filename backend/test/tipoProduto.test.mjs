import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoProduto } from '../src/normaliza/tipoProduto.js';

test('tem nutrição → food (definitivo)', () => {
  assert.equal(tipoProduto({ nome: 'Iogurte Grego', temNutricao: true }), 'food');
  assert.equal(tipoProduto({ nome: 'Qualquer coisa', foodGroups: ['en:dairy'] }), 'food');
});

test('não-alimento pelo NOME, mesmo com categoria de alimento errada', () => {
  // caso real: protetor solar mal-tagueado como "Laticínios" no catálogo
  assert.equal(tipoProduto({ nome: 'Leite de Proteção Solar FPS 50', categoria: 'Laticínios' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Detergente da Loiça Limão' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Filtros de Café nº4' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Champô Anticaspa' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Pilhas AA Alcalinas' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Papel Higiénico 12 Rolos' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Sacos do Lixo 30L' }), 'non_food');
});

test('não-alimento pela CATEGORIA', () => {
  assert.equal(tipoProduto({ nome: 'Marca X', categoria: 'Beleza E Higiene' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Marca Y', categoria: 'Limpeza' }), 'non_food');
  assert.equal(tipoProduto({ nome: 'Ração Premium', categoria: 'Gato' }), 'non_food');
});

test('alimento SEM nutrição (água/vinho/especiaria) → food, não "não alimentício"', () => {
  assert.equal(tipoProduto({ nome: 'Água Mineral Natural 1,5L' }), 'food');
  assert.equal(tipoProduto({ nome: 'Vinho Tinto Douro Reserva', categoria: 'Vinho Tinto' }), 'food');
  assert.equal(tipoProduto({ nome: 'Café em Grão 1kg' }), 'food');
  assert.equal(tipoProduto({ nome: 'Orégãos Folha' }), 'food');
  assert.equal(tipoProduto({ nome: 'Chá Verde 20 Saquetas' }), 'food');
  assert.equal(tipoProduto({ nome: 'Sal Fino Marinho' }), 'food');
});

test('alimento pela categoria', () => {
  assert.equal(tipoProduto({ nome: 'Coisa', categoria: 'Mercearia' }), 'food');
  assert.equal(tipoProduto({ nome: 'Coisa', categoria: 'Iogurtes' }), 'food');
});

test('ambíguo → null', () => {
  assert.equal(tipoProduto({ nome: 'Produto Misterioso XYZ' }), null);
  assert.equal(tipoProduto({}), null);
});

test('alimento com nome que parece não-alimento mas tem nutrição → food (rule 1 vence)', () => {
  // "creme" de leite é alimento; com nutrição é food independentemente de tudo
  assert.equal(tipoProduto({ nome: 'Creme de Leite', temNutricao: true }), 'food');
});

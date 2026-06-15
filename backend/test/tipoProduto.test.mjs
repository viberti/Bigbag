import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoProduto, decidirTipo } from '../src/normaliza/tipoProduto.js';

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

// ── decidirTipo: o fusor food/não-food com proveniência ──────────────────────
test('decidirTipo: nutrição vence tudo, com via', () => {
  assert.deepEqual(decidirTipo({ nome: 'X', temNutricao: true }), { tipo: 'food', via: 'nutricao' });
});

test('decidirTipo: VLM-tipo desfaz o homónimo (nome sozinho falharia)', () => {
  // "Pérolas" sozinho é ambíguo/enganador; o tipo do pacote resolve.
  assert.equal(tipoProduto({ nome: 'Pérolas' }), null); // o nome cru não decide
  assert.deepEqual(decidirTipo({ nome: 'Pérolas', tipoTexto: 'massa alimentícia de qualidade superior' }), { tipo: 'food', via: 'vlm-tipo' });
});

test('decidirTipo: VLM-tipo derruba o prior — vela de marca alimentar', () => {
  // Hacendado é 99% food (marcaShareFood alto), mas isto é uma vela: o VLM vê e vence.
  assert.deepEqual(decidirTipo({ nome: 'Vela de Cumpleaños', tipoTexto: 'vela de aniversário', marcaShareFood: 0.99 }), { tipo: 'non_food', via: 'vlm-tipo' });
});

test('decidirTipo: voto da marca (mini marca_perfil) quando o resto não decide', () => {
  assert.deepEqual(decidirTipo({ nome: 'Produto XYZ', marcaShareFood: 0.99 }), { tipo: 'food', via: 'marca' });
  assert.deepEqual(decidirTipo({ nome: 'Produto XYZ', marcaShareFood: 0.02 }), { tipo: 'non_food', via: 'marca' });
});

test('decidirTipo: sem sinais fortes → cai na cascata nome/categoria', () => {
  assert.deepEqual(decidirTipo({ nome: 'Detergente da Loiça' }), { tipo: 'non_food', via: 'nome-categoria' });
  assert.deepEqual(decidirTipo({ nome: 'Coisa', categoria: 'Mercearia' }), { tipo: 'food', via: 'nome-categoria' });
  assert.deepEqual(decidirTipo({ nome: 'Misterioso XYZ' }), { tipo: null, via: 'ambiguo' });
});

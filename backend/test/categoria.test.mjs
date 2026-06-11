import test from 'node:test';
import assert from 'node:assert/strict';
import { grupoDeTexto, grupoDe } from '../src/normaliza/categoria.js';

test('mapeia categorias texto-livre conhecidas', () => {
  assert.equal(grupoDeTexto('Frutas e Legumes'), 'frutas');
  assert.equal(grupoDeTexto('Mercearia Doce'), 'doces'); // 'doce' ganha (1.º match na ordem)
  assert.equal(grupoDeTexto('Talho'), 'carne');
  assert.equal(grupoDeTexto('Laticínios'), 'lacticinios');
  assert.equal(grupoDeTexto('Higiene e Beleza'), 'higiene');
  assert.equal(grupoDeTexto('Padaria e Pastelaria'), 'padaria');
});

test('regressões conhecidas: início de palavra, não substring', () => {
  assert.notEqual(grupoDeTexto('BATATA VERMELHA'), 'doces');  // "vermelha" continha "mel"
  assert.notEqual(grupoDeTexto('CHAMPO SUAVE'), 'bebidas');   // "champo" continha "cha"
  assert.equal(grupoDeTexto('CHAMPO SUAVE'), 'higiene');
  assert.equal(grupoDeTexto('MEL DE ROSMANINHO'), 'doces');   // "mel" palavra inteira ✓
});

test('fallback pelo nome quando a categoria não diz nada', () => {
  assert.equal(grupoDe({ categoria: 'X', nome: 'Banana' }), 'outros'); // banana não é termo... fica p/ frescos via categoria
  assert.equal(grupoDe({ categoria: null, nome: 'Iogurte Grego Natural' }), 'lacticinios');
  assert.equal(grupoDe({ categoria: null, nome: 'Sumo de Laranja' }), 'bebidas');
});

test('food_groups do OFF é autoritativo', () => {
  assert.equal(grupoDe({ foodGroups: ['en:sugary-snacks'], categoria: 'Mercearia', nome: 'X' }), 'doces');
  assert.equal(grupoDe({ foodGroups: ['en:beverages'], nome: 'Coisa' }), 'bebidas');
});

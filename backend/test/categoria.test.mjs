import test from 'node:test';
import assert from 'node:assert/strict';
import { grupoDeTexto, grupoDe, tokenCasa, singularizar } from '../src/normaliza/categoria.js';

test('singularizar: classes do português que aparecem em produtos', () => {
  assert.equal(singularizar('paes'), 'pao');         // pães → pão
  assert.equal(singularizar('limoes'), 'limao');     // limões → limão
  assert.equal(singularizar('meloes'), 'melao');
  assert.equal(singularizar('camaroes'), 'camarao');
  assert.equal(singularizar('feijoes'), 'feijao');
  assert.equal(singularizar('pasteis'), 'pastel');   // pastéis → pastel
  assert.equal(singularizar('integrais'), 'integral'); // bolachas integrais
  assert.equal(singularizar('naturais'), 'natural');
  assert.equal(singularizar('bombons'), 'bombom');
  assert.equal(singularizar('flores'), 'flor');
  assert.equal(singularizar('arrozes'), 'arroz');
  assert.equal(singularizar('uvas'), 'uva');
  assert.equal(singularizar('iogurtes'), 'iogurte');
  // intactos: curtos e singulares
  assert.equal(singularizar('pao'), 'pao');
  assert.equal(singularizar('sal'), 'sal');
  assert.equal(singularizar('mais'), 'mais');        // len 4, 'ais' exige ≥5
  assert.equal(singularizar('pais'), 'pais');
});

test('tokenCasa: plurais irregulares casam nos dois sentidos', () => {
  assert.ok(tokenCasa('pao', 'paes'));     // nome singular, pedido plural
  assert.ok(tokenCasa('paes', 'pao'));     // nome plural, pedido singular
  assert.ok(tokenCasa('limoes', 'limao'));
  assert.ok(tokenCasa('pasteis', 'pastel'));
  assert.ok(tokenCasa('integrais', 'integral'));
  assert.ok(!tokenCasa('leitao', 'leite'));  // leitão ≠ leite
  assert.ok(!tokenCasa('pastel', 'pasta'));  // pastel ≠ pasta
});

test('tokenCasa: igualdade e plural casam, prefixo curto NÃO (sal≠salmão)', () => {
  assert.ok(tokenCasa('leite', 'leite'));        // igual
  assert.ok(tokenCasa('iogurtes', 'iogurte'));   // plural (nome +1)
  assert.ok(tokenCasa('queijos', 'queijo'));     // plural
  assert.ok(tokenCasa('iogurte', 'iogurtes'));   // pedido no plural, nome raiz ≥4
  assert.ok(!tokenCasa('salmao', 'sal'));        // o bug: "sal" não casa "salmão"
  assert.ok(!tokenCasa('salsicha', 'sal'));
  assert.ok(!tokenCasa('salada', 'sal'));
  assert.ok(!tokenCasa('arroz', 'arr'));         // prefixo curto genérico
  assert.ok(tokenCasa('sal', 'sal'));            // "sal" casa "sal"
});

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

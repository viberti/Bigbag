import test from 'node:test';
import assert from 'node:assert/strict';
import { grupoDeTexto, grupoDe, grupoDeNome, tokenCasa, singularizar, chaveItemLista } from '../src/normaliza/categoria.js';

test('chaveItemLista: plurais/acentos/maiusculas consolidam no MESMO item', () => {
  assert.equal(chaveItemLista('Ovo'), chaveItemLista('ovos'));
  assert.equal(chaveItemLista('Banana'), chaveItemLista('BANANAS '));
  assert.equal(chaveItemLista('Pão'), chaveItemLista('pao'));
  assert.equal(chaveItemLista('Maçãs'), chaveItemLista('maca'));
  assert.equal(chaveItemLista('Limões'), chaveItemLista('limao'));
  // itens diferentes NÃO colidem
  assert.notEqual(chaveItemLista('Leite'), chaveItemLista('Leite Meio Gordo'));
  assert.notEqual(chaveItemLista('Sal'), chaveItemLista('Salmão'));
});

test('grupoDeNome: substantivo-cabeça vence palavra forte de outro grupo (achados do LLM-juiz)', () => {
  assert.equal(grupoDeNome('Croissant de Manteiga'), 'padaria');     // não lacticinios
  assert.equal(grupoDeNome('Esparguete com Ovo'), 'padaria');        // não lacticinios
  assert.equal(grupoDeNome('Batata Doce'), 'frutas');                // não doces
  assert.equal(grupoDeNome('Abóbora Manteiga (Butternut)'), 'frutas'); // não lacticinios
  assert.equal(grupoDeNome('Patê de Alho e Salsa'), 'carne');        // não frutas (salsa)
  assert.equal(grupoDeNome('Gorgonzola Picante'), 'lacticinios');
  assert.equal(grupoDeNome('Massa Fresca de Ovo com Ricotta'), 'padaria');
  // e os normais continuam certos
  assert.equal(grupoDeNome('Leite Meio Gordo'), 'lacticinios');
  assert.equal(grupoDeNome('Doce de Leite'), 'doces');               // cabeça = doce ✓
  assert.equal(grupoDeNome('Queijo Gouda'), 'lacticinios');
  assert.equal(grupoDeNome('Sumo de Laranja'), 'bebidas');
  assert.equal(grupoDeNome('Salada de Frutas'), 'frutas');
  // 'milk_' = palavra inteira: "Milka" não é leite (era lacticinios)
  assert.notEqual(grupoDeNome('Milka Confetti'), 'lacticinios');
  assert.equal(grupoDeTexto('milk'), 'lacticinios'); // a palavra inteira continua a casar
  assert.equal(grupoDeNome('Gnocchi de Batata'), 'padaria');   // massa, não legume
  assert.equal(grupoDeNome('Tortilhas de Trigo'), 'padaria');
});

test('grupoDe: precedências cirúrgicas (kefir lácteo > OFF-bebidas; congelados de loja > nome)', () => {
  // OFF diz "beverages" para kefir → o nome lácteo vence
  assert.equal(grupoDe({ foodGroups: ['en:beverages', 'en:unsweetened-beverages'], nome: 'Kefir Natural' }), 'lacticinios');
  // sumo continua bebidas (nome não é lácteo)
  assert.equal(grupoDe({ foodGroups: ['en:unsweetened-beverages'], nome: 'Sumo de Laranja' }), 'bebidas');
  // categoria de loja Congelados vence o nome (batata→frutas)
  assert.equal(grupoDe({ categoria: 'Congelados', nome: 'Batata aos Cubos para Airfryer' }), 'congelados');
  // mas a lição Charcutaria-e-Queijos mantém-se: nome vence as outras categorias
  assert.equal(grupoDe({ categoria: 'Charcutaria e Queijos', nome: 'Queijo Grana Padano' }), 'lacticinios');
});

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

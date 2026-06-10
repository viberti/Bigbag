import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tituloProduto } from '../src/normaliza/titulo.js';

test('ALLCAPS vira Título PT com palavras pequenas minúsculas', () => {
  assert.equal(tituloProduto('MEL SERRAMEL ROSMANINHO 500G'), 'Mel Serramel Rosmaninho 500g');
  assert.equal(tituloProduto('QUEIJO DE CABRA CURADO'), 'Queijo de Cabra Curado');
  assert.equal(tituloProduto('PINGO DOCE'), 'Pingo Doce');
});

test('siglas preservadas', () => {
  assert.equal(tituloProduto('LEITE UHT MEIO GORDO'), 'Leite UHT Meio Gordo');
  assert.equal(tituloProduto('QUEIJO SERRA DA ESTRELA DOP'), 'Queijo Serra da Estrela DOP');
  assert.equal(tituloProduto('CERVEJA IPA ARTESANAL'), 'Cerveja IPA Artesanal');
});

test('já em Título ou capitalização mista fica intacto', () => {
  assert.equal(tituloProduto('Mel de Rosmaninho'), 'Mel de Rosmaninho');
  assert.equal(tituloProduto('SerraMel'), 'SerraMel');
  assert.equal(tituloProduto("McVitie's Digestive"), "McVitie's Digestive");
});

test('tudo-minúsculas capitaliza; 1.ª palavra nunca fica pequena', () => {
  assert.equal(tituloProduto('iogurte grego natural'), 'Iogurte Grego Natural');
  assert.equal(tituloProduto('de cecco massa'), 'De Cecco Massa');
});

test('unidades após dígitos em minúsculas; tokens com dígitos no meio ficam', () => {
  assert.equal(tituloProduto('AZEITE 750ML'), 'Azeite 750ml');
  assert.equal(tituloProduto('PACK 6x33CL'), 'Pack 6x33CL');
});

test('hífen e apóstrofo capitalizam a seguir', () => {
  assert.equal(tituloProduto('COCA-COLA ZERO'), 'Coca-Cola Zero');
  assert.equal(tituloProduto("D'OURO VINHO"), "D'Ouro Vinho");
});

test('vazio/nulo → null; espaços colapsam', () => {
  assert.equal(tituloProduto(''), null);
  assert.equal(tituloProduto(null), null);
  assert.equal(tituloProduto('  MEL   DE  FLORES  '), 'Mel de Flores');
});

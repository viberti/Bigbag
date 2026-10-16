import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparFormaGeral as f } from '../src/nomeGeral.js';

test('tira contagens e tamanhos', () => {
  assert.equal(f('24 OVOS Frescos'), 'Ovos Frescos');
  assert.equal(f('Leite UHT Meio Gordo 1L'), 'Leite UHT Meio Gordo');
  assert.equal(f('Iogurte Grego 4x125g'), 'Iogurte Grego');
  assert.equal(f('Café Moído 250 g'), 'Café Moído');
  assert.equal(f('Chá Verde 20 saquetas'), 'Chá Verde');
});
test('maiúsculas de talão viram normais; siglas curtas ficam', () => {
  assert.equal(f('LEITE UHT MEIO GORDO'), 'Leite UHT Meio Gordo');
  assert.equal(f('Laranja Citrinos IGP'), 'Laranja Citrinos IGP');
});
test('nomes já gerais não mudam', () => {
  for (const n of ['Ovos', 'Pão de forma', 'Carne picada bovina', 'Pao shape', 'Leite Meio Gordo']) assert.equal(f(n), n);
});
test('números que fazem parte do nome sem unidade ficam (ex.: 7up, 100% sumo)', () => {
  assert.equal(f('Sumo 100% Laranja'), 'Sumo 100% Laranja');
});

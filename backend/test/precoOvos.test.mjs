import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precoLista } from '../../frontend/src/listaFormato.js';

test('ovos: dúzia = €/ovo × 12 (caso real: pacote de 24 a 4,99 € → 2,50 €/dúzia)', () => {
  assert.equal(precoLista({ nome: 'Ovos', unidade_base: 'un', melhor_preco: 0.2079, preco_pago: 4.99 }), '2,49 €/dúzia');
});
test('ovos: "€/ovo" implausível (pacote sem contagem) → preço do pacote, sem rótulo de dúzia', () => {
  assert.equal(precoLista({ nome: 'Ovos Classe L', unidade_base: 'un', melhor_preco: 3.75, preco_pago: 3.75 }), '3,75 €');
});
test('ovos: sem preço nenhum', () => {
  assert.equal(precoLista({ nome: 'Ovos' }), 'sem preço');
});
test('não-ovos não mudam', () => {
  assert.equal(precoLista({ nome: 'Leite', unidade_base: 'L', melhor_preco: 0.86, preco_pago: 0.86 }), '0,86 €');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nutricaoCanonica, tierCanonico, familiasCanonicas } from '../src/normaliza/nutricaoCanonica.js';

test('ovo simples → nutrição canónica (default)', () => {
  const r = nutricaoCanonica('ovos', 'Ovos Classe L');
  assert.ok(r && r.nut.energia_kcal === 143 && r.tier === 1);
});

test('QUEBRA: ovo com qualificador que muda o perfil → null (não força)', () => {
  assert.equal(nutricaoCanonica('ovos', 'Ovos Ómega 3'), null);          // enriquecido
  assert.equal(nutricaoCanonica('ovos', 'Clara de Ovo Pasteurizada Líquida'), null); // clara/líquido
  assert.equal(nutricaoCanonica('ovos', 'Ovos de Codorniz'), null);      // outro animal
});

test('arroz: variante por nome (integral vs branco-default)', () => {
  assert.equal(nutricaoCanonica('arroz', 'Arroz Integral 1kg').nut.fibra, 4.8);
  assert.equal(nutricaoCanonica('arroz', 'Arroz Agulha Extra Longo').nut.energia_kcal, 358); // default = branco
  assert.equal(nutricaoCanonica('arroz', 'Arroz Cozido Pronto'), null);  // forma cozida → não força
});

test('farinha_acucar: separa açúcar de farinha pelo nome', () => {
  assert.equal(nutricaoCanonica('farinha_acucar', 'Açúcar Branco Refinado').nut.acucares, 99.6);
  assert.equal(nutricaoCanonica('farinha_acucar', 'Farinha de Trigo T65').nut.proteina, 9.8);
  assert.equal(nutricaoCanonica('farinha_acucar', 'Amido de Milho Maizena'), null); // quebra (amido)
});

test('família não-commodity → null', () => {
  assert.equal(nutricaoCanonica('chocolate', 'Chocolate Negro'), null);
  assert.equal(nutricaoCanonica(null, 'x'), null);
});

test('helpers', () => {
  assert.equal(tierCanonico('ovos'), 1);
  assert.ok(familiasCanonicas().includes('arroz') && !familiasCanonicas().some((k) => k[0] === '_'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { facetasDe, compararFacetas, saborConflito } from '../src/normaliza/facetas.js';

test('extrai facetas por classe, com sinónimos multilingue', () => {
  const f = facetasDe('Yogur griego fresa desnatado sin lactosa');
  assert.ok(f.sabor.has('morango'));
  assert.ok(f.teor.has('magro'));
  assert.ok(f.dieta.has('sem lactose'));
});

test('conflito: sabores diferentes nos dois lados', () => {
  assert.equal(compararFacetas('Chocolate Preto com Caramelo', 'Chocolate Preto com Avelãs'), 'conflito');
  assert.equal(compararFacetas('Iogurte Grego Morango', 'Greek Yogurt Strawberry'), 'igual'); // sinónimo EN
  assert.equal(compararFacetas('Iogurte Natural', 'Iogurte Morango'), 'conflito'); // natural é VALOR
});

test('conflito: teor diferente (magro vs meio-gordo)', () => {
  assert.equal(compararFacetas('Leite Magro', 'Leite Meio-Gordo'), 'conflito');
  assert.equal(compararFacetas('Leche desnatada', 'Leite Magro'), 'igual'); // ES
});

test('ausente: um lado declara, o outro omite → nunca auto-match', () => {
  assert.equal(compararFacetas('Iogurte Grego Natural Magro', 'Iogurte Grego Natural'), 'ausente');
  assert.equal(compararFacetas('IOG GREGO', 'Iogurte Grego Natural'), 'ausente');
});

test('igual: sem facetas dos dois lados', () => {
  assert.equal(compararFacetas('Banana', 'Banana da Madeira'), 'igual');
});

test('saborConflito mantém a semântica histórica (exact-set, talão manda)', () => {
  assert.equal(saborConflito('IOG MORANGO', 'Iogurte Baunilha'), true);   // morango ≠ baunilha
  assert.equal(saborConflito('IOG COCO', 'Iogurte Ananás e Coco'), true); // a MAIS também conflita
  assert.equal(saborConflito('IOG COCO', 'Iogurte Natural'), true);       // liso ≠ coco
  assert.equal(saborConflito('IOGURTE GREGO', 'Iogurte Grego Morango'), false); // talão sem sabor não bloqueia
  assert.equal(saborConflito('IOG FRESA', 'Iogurte Morango'), false);     // sinónimo ES = mesmo valor
});

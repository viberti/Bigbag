import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nutriScore } from '../src/normaliza/nutriscore.js';

test('alimento muito saudável (leguminosa) → A, pontos negativos', () => {
  // energia 116 kcal→485 kJ→1pt; açúcar 1→0; sat 0.1→0; sódio 8mg→0 ⇒ A=1. fibra 8→5; proteína 9→5.
  // A<11 ⇒ pontos = 1 − (5+5) = −9 ⇒ A.
  const r = nutriScore({ energia_kcal: 116, acucares: 1, gordura_saturada: 0.1, sal: 0.02, fibra: 8, proteina: 9 });
  assert.equal(r.pontos, -9);
  assert.equal(r.grau, 'A');
});

test('produto mau (alto açúcar/sat/sal) → E; proteína NÃO compensa (A≥11)', () => {
  // energia 525 kcal→2197 kJ→6; açúcar 40→8; sat 8→7; sódio 600mg→6 ⇒ A=27. fibra 1→1; proteína 5→2.
  // A≥11 ⇒ proteína não conta ⇒ pontos = 27 − (fibra 1) = 26 ⇒ E.
  const r = nutriScore({ energia_kcal: 525, acucares: 40, gordura_saturada: 8, sal: 1.5, fibra: 1, proteina: 5 });
  assert.equal(r.pontos, 26);
  assert.equal(r.grau, 'E');
});

test('nutrição em falta → null', () => {
  assert.equal(nutriScore(null), null);
  assert.equal(nutriScore({ energia_kcal: 100 }), null); // faltam macros obrigatórios
});

test('grau segue os cortes oficiais (A≤−1, B 0..2, C 3..10, D 11..18, E≥19)', () => {
  // açúcar puro: energia 400 kcal→1674 kJ→4; açúcar 100→10; sat 0; sódio 0 ⇒ A=14; fibra 0; proteína 0.
  // A≥11 ⇒ pontos = 14 ⇒ D.
  const r = nutriScore({ energia_kcal: 400, acucares: 100, gordura_saturada: 0, sal: 0, fibra: 0, proteina: 0 });
  assert.equal(r.pontos, 14);
  assert.equal(r.grau, 'D');
});

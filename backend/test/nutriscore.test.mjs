import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nutriScore } from '../src/normaliza/nutriscore.js';

// Algoritmo NUTRI-SCORE 2023 (sólidos gerais). Valores calculados à mão com as tabelas novas.

test('alimento muito saudável (leguminosa) → A', () => {
  // energia 116 kcal→485 kJ→1; açúcar 1→0; sat 0.1→0; sal 0.02→0 ⇒ A=1. fibra 8→5; proteína 9→3 (escala 2023).
  // A<11 ⇒ pontos = 1 − (5+3) = −7 ⇒ A.
  const r = nutriScore({ energia_kcal: 116, acucares: 1, gordura_saturada: 0.1, sal: 0.02, fibra: 8, proteina: 9 });
  assert.equal(r.pontos, -7);
  assert.equal(r.grau, 'A');
});

test('produto mau (alto açúcar/sat/sal) → E; proteína NÃO compensa (negativos≥11)', () => {
  // energia 525 kcal→2197 kJ→6; açúcar 40→11 (escala 0..15); sat 8→7; sal 1.5→7 (escala 0..20) ⇒ A=31.
  // A≥11 ⇒ proteína (5→2) não conta ⇒ pontos = 31 − (fibra 1→0) = 31 ⇒ E.
  const r = nutriScore({ energia_kcal: 525, acucares: 40, gordura_saturada: 8, sal: 1.5, fibra: 1, proteina: 5 });
  assert.equal(r.pontos, 31);
  assert.equal(r.grau, 'E');
});

test('nutrição em falta → null', () => {
  assert.equal(nutriScore(null), null);
  assert.equal(nutriScore({ energia_kcal: 100 }), null); // faltam macros obrigatórios
});

test('açúcar puro → E na escala 2023 (era D em 2017: escala do açúcar passou a 0..15)', () => {
  // energia 400 kcal→1674 kJ→4; açúcar 100→15; sat 0; sal 0 ⇒ A=19; fibra 0; proteína 0.
  // A≥11 ⇒ pontos = 19 ⇒ E (em 2017 dava 14 ⇒ D).
  const r = nutriScore({ energia_kcal: 400, acucares: 100, gordura_saturada: 0, sal: 0, fibra: 0, proteina: 0 });
  assert.equal(r.pontos, 19);
  assert.equal(r.grau, 'E');
});

test('sal usa-se direto (g), não sódio: 1 g de sal → 4 pontos de sal', () => {
  // só o sal contribui: energia 0→0; açúcar 0→0; sat 0→0; sal 1.0→4 ⇒ A=4; sem fibra/proteína ⇒ pontos 4 ⇒ C.
  const r = nutriScore({ energia_kcal: 0, acucares: 0, gordura_saturada: 0, sal: 1.0, fibra: 0, proteina: 0 });
  assert.equal(r.pontos, 4);
  assert.equal(r.grau, 'C');
});

// ── ESCALA DE BEBIDAS (2023) — energia/açúcar muito mais severas; só a água é A.
test('LEITE como bebida → B (na escala de sólidos dava A/0)', () => {
  const n = { energia_kcal: 48, acucares: 4.9, gordura_saturada: 1, sal: 0.1, fibra: 0, proteina: 3.4 };
  // sólidos: dava pontos 0 → A (o problema relatado).
  assert.equal(nutriScore(n).grau, 'A');
  // bebida: energia 200.8 kJ→3; açúcar 4.9→3; sat 1→0; sal 0.1→0 ⇒ A=6. proteína 3.4→7 (escala bebida). pontos = 6−7 = −1 ⇒ B.
  const r = nutriScore(n, { classe: 'bebida' });
  assert.equal(r.pontos, -1);
  assert.equal(r.grau, 'B');
});

test('água → sempre A (flag de água)', () => {
  const r = nutriScore({ energia_kcal: 0, acucares: 0, gordura_saturada: 0, sal: 0, fibra: 0, proteina: 0 }, { classe: 'agua' });
  assert.equal(r.grau, 'A');
});

test('refrigerante açucarado → E na escala de bebidas', () => {
  // cola: energia 42 kcal→175.7 kJ→3; açúcar 10.6→9; sat 0; sal 0 ⇒ A=12 ⇒ proteína não conta. pontos 12 ⇒ >9 ⇒ E.
  const r = nutriScore({ energia_kcal: 42, acucares: 10.6, gordura_saturada: 0, sal: 0, fibra: 0, proteina: 0 }, { classe: 'bebida' });
  assert.equal(r.pontos, 12);
  assert.equal(r.grau, 'E');
});

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

// ── ESCALA DE GORDURAS/ÓLEOS (2023) — energia da saturada + rácio saturada/total.
test('AZEITE como gordura → C (na escala de sólidos dava E)', () => {
  const n = { energia_kcal: 822, gordura: 91.6, gordura_saturada: 15.3, acucares: 0, sal: 0, fibra: 0, proteina: 0 };
  assert.equal(nutriScore(n).grau, 'E'); // sólidos: injustamente E
  // gordura: energia-sat 15.3×37=566→4; rácio 16.7%→2; açúcar 0; sal 0 ⇒ A=6 ⇒ C.
  const r = nutriScore(n, { classe: 'gordura' });
  assert.equal(r.pontos, 6);
  assert.equal(r.grau, 'C');
});

test('óleo de COCO (muito saturado) → E mesmo na escala de gorduras', () => {
  // energia-sat 87×37=3219→10; rácio 87%→10 ⇒ A=20 ⇒ E. Diferencia do azeite.
  const r = nutriScore({ energia_kcal: 862, gordura: 100, gordura_saturada: 87, acucares: 0, sal: 0, fibra: 0, proteina: 0 }, { classe: 'gordura' });
  assert.equal(r.grau, 'E');
});

test('gordura SEM gordura total → null (não adivinha; o rácio é o que decide)', () => {
  // sem a gordura total não há rácio saturada/total → não dá p/ classificar um óleo. NULL é honesto
  // (antes caía p/ sólidos e dava um E injusto). MENOS info NUNCA pode dar uma nota.
  const r = nutriScore({ energia_kcal: 822, gordura: null, gordura_saturada: 15.3, acucares: 0, sal: 0 }, { classe: 'gordura' });
  assert.equal(r, null);
});

test('AZEITE sem açúcar/sal na ficha → assume 0 (são ~0 no óleo) e dá nota CONSISTENTE', () => {
  // bug real: 40 azeites davam null só porque açúcar/sal estavam a NULL. Num óleo puro são 0 →
  // assume-se 0 (verdade, não palpite) e a nota fica igual à dos azeites com a ficha completa.
  const completo = nutriScore({ energia_kcal: 822, gordura: 91, gordura_saturada: 13, acucares: 0, sal: 0 }, { classe: 'gordura' });
  const semAcSal = nutriScore({ energia_kcal: 822, gordura: 91, gordura_saturada: 13, acucares: null, sal: null }, { classe: 'gordura' });
  assert.ok(completo && semAcSal);
  assert.equal(semAcSal.nota100, completo.nota100); // MESMA nota → consistência entre azeites
});

test('DADOS IMPOSSÍVEIS → null: macro negativo ou saturada > gordura total', () => {
  // saturada negativa (lixo do OFF, "Azeite 2l" sat=-1)
  assert.equal(nutriScore({ energia_kcal: 822, gordura: 91, gordura_saturada: -1, acucares: 0, sal: 0 }, { classe: 'gordura' }), null);
  // saturada (72) maior que a gordura total (13) — impossível (total mal metido no campo da saturada)
  assert.equal(nutriScore({ energia_kcal: 822, gordura: 13, gordura_saturada: 72, acucares: 0, sal: 0 }, { classe: 'gordura' }), null);
  // açúcar negativo num sólido
  assert.equal(nutriScore({ energia_kcal: 400, gordura_saturada: 2, acucares: -5, sal: 0.5 }), null);
});

test('SÓLIDO/BEBIDA sem açúcar ou sal → null (negativos relevantes, não se assume 0)', () => {
  assert.equal(nutriScore({ energia_kcal: 400, gordura_saturada: 2, acucares: null, sal: 0.5 }), null);
  assert.equal(nutriScore({ energia_kcal: 42, gordura_saturada: 0, acucares: 10, sal: null }, { classe: 'bebida' }), null);
});

// ── NOTA 0–100 (apresentação NOSSA, maior = mais saudável; ancorada nas fronteiras das letras)
test('nota100: ancorada nas bandas das letras (maior = mais saudável)', () => {
  // leguminosa A (pontos −7, sólido) → banda A (80..100): ~89
  assert.equal(nutriScore({ energia_kcal: 116, acucares: 1, gordura_saturada: 0.1, sal: 0.02, fibra: 8, proteina: 9 }).nota100, 89);
  // produto mau E (pontos 31, sólido) → banda E (0..20): ~8
  assert.equal(nutriScore({ energia_kcal: 525, acucares: 40, gordura_saturada: 8, sal: 1.5, fibra: 1, proteina: 5 }).nota100, 8);
  // leite B (pontos −1, bebida) → banda B (60..80): 75
  assert.equal(nutriScore({ energia_kcal: 48, acucares: 4.9, gordura_saturada: 1, sal: 0.1, fibra: 0, proteina: 3.4 }, { classe: 'bebida' }).nota100, 75);
  // azeite C (pontos 6, gordura) → banda C (40..60): 50
  assert.equal(nutriScore({ energia_kcal: 822, gordura: 91.6, gordura_saturada: 15.3, acucares: 0, sal: 0, fibra: 0, proteina: 0 }, { classe: 'gordura' }).nota100, 50);
  // água → 100
  assert.equal(nutriScore({ energia_kcal: 0, acucares: 0, gordura_saturada: 0, sal: 0 }, { classe: 'agua' }).nota100, 100);
});

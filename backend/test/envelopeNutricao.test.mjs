import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirEnvelopes, nutricaoSuspeita } from '../src/normaliza/envelopeNutricao.js';

// 60 azeites "normais" (saturada ~13-15, kcal ~820) → família HOMOGÉNEA → envelope apertado.
const azeites = Array.from({ length: 60 }, (_, i) => ({
  familia: 'azeite',
  n: { energia_kcal: 818 + (i % 6), gordura: 91 + (i % 3) * 0.1, gordura_saturada: 13 + (i % 3), acucares: 0, hidratos: 0, proteina: 0, sal: 0 },
}));

test('construirEnvelopes: família homogénea c/ ≥40 amostras gera envelope (percentis)', () => {
  const env = construirEnvelopes(azeites);
  assert.ok(env.azeite && env.azeite.gordura_saturada, 'azeite tem envelope de saturada');
  assert.ok(env.azeite.gordura_saturada.p50 >= 13 && env.azeite.gordura_saturada.p50 <= 15);
  // poucas amostras → sem envelope
  assert.equal(construirEnvelopes([{ familia: 'raro', n: { gordura: 1 } }]).raro, undefined);
});

test('GATE de homogeneidade: família multimodal (leite líquido+pó) NÃO gera envelope de kcal', () => {
  // 54 leites líquidos (~63 kcal) + 6 em pó (~484 kcal) — cauda longe da mediana → SKIP
  const leites = [
    ...Array.from({ length: 54 }, (_, i) => ({ familia: 'leite', n: { energia_kcal: 60 + (i % 6) } })),
    ...Array.from({ length: 6 }, () => ({ familia: 'leite', n: { energia_kcal: 484 } })),
  ];
  const env = construirEnvelopes(leites);
  assert.ok(!env.leite || !env.leite.energia_kcal, 'leite heterogéneo não tem envelope de kcal → não sinaliza o pó');
});

test('nutricaoSuspeita: azeite saturada=72 é outlier (o caso real)', () => {
  const env = construirEnvelopes(azeites);
  const susp = nutricaoSuspeita({ energia_kcal: 821, gordura: 91, gordura_saturada: 72, acucares: 0, proteina: 0 }, 'azeite', env);
  assert.ok(susp.find((s) => s.nutriente === 'gordura_saturada' && s.lado === 'alto'));
});

test('nutricaoSuspeita: azeite normal e desvio pequeno NÃO sinalizam', () => {
  const env = construirEnvelopes(azeites);
  assert.deepEqual(nutricaoSuspeita({ energia_kcal: 820, gordura: 91, gordura_saturada: 14, acucares: 0 }, 'azeite', env), []);
  // saturada=0,1 com mediana 0 e piso 1 → dentro do ruído (era o falso positivo do Néctar)
  assert.deepEqual(nutricaoSuspeita({ acucares: 0.1 }, 'azeite', env), []);
});

test('nutricaoSuspeita: sem envelope / sem família → não sinaliza (honesto)', () => {
  const env = construirEnvelopes(azeites);
  assert.deepEqual(nutricaoSuspeita({ gordura_saturada: 99 }, 'familia_sem_dados', env), []);
  assert.deepEqual(nutricaoSuspeita({ gordura_saturada: 99 }, null, env), []);
});

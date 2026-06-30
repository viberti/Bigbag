import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confiancaNutricao } from '../src/normaliza/confiancaNutricao.js';
import { construirEnvelopes } from '../src/normaliza/envelopeNutricao.js';

const envAzeite = construirEnvelopes(
  Array.from({ length: 60 }, (_, i) => ({ familia: 'azeite', n: { energia_kcal: 818 + (i % 6), gordura: 91, gordura_saturada: 13 + (i % 3), acucares: 0, hidratos: 0, proteina: 0, sal: 0 } })),
);
const completo = { energia_kcal: 822, gordura: 91, gordura_saturada: 14, acucares: 0, sal: 0, proteina: 0, fibra: 0, hidratos: 0 };

test('confiança ALTO: nutrição completa, corroborada, dentro da família', () => {
  const c = confiancaNutricao(completo, { familia: 'azeite', confirmada: true, envelopes: envAzeite });
  assert.equal(c.nivel, 'alto');
  assert.equal(c.suspeitos.length, 0);
});

test('confiança BAIXO: nutriente improvável para a família (azeite saturada=72)', () => {
  const c = confiancaNutricao({ ...completo, gordura_saturada: 72 }, { familia: 'azeite', confirmada: true, envelopes: envAzeite });
  assert.equal(c.nivel, 'baixo');
  assert.ok(c.suspeitos.find((s) => s.nutriente === 'gordura_saturada'));
});

test('confiança MÉDIO: não corroborado (só leitura por imagem)', () => {
  const c = confiancaNutricao(completo, { familia: 'azeite', confirmada: false, envelopes: envAzeite });
  assert.equal(c.nivel, 'medio');
  assert.ok(c.motivos.some((m) => /imagem/.test(m)));
});

test('confiança MÉDIO: nutrição parcial mesmo que corroborada', () => {
  const c = confiancaNutricao({ energia_kcal: 822, gordura_saturada: 14, acucares: 0, sal: 0 }, { familia: 'azeite', confirmada: true, envelopes: envAzeite });
  assert.equal(c.nivel, 'medio');
  assert.ok(c.motivos.some((m) => /parcial/.test(m)));
});

test('confiança NENHUM: sem nutrição', () => {
  assert.equal(confiancaNutricao(null, {}).nivel, 'nenhum');
});

test('sem envelopes (dev/sem artefacto) → não rebenta, sem suspeita de família', () => {
  const c = confiancaNutricao(completo, { familia: 'azeite', confirmada: true });
  assert.equal(c.nivel, 'alto');
  assert.equal(c.suspeitos.length, 0);
});

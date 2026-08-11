import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDia } from '../src/normaliza/dia.js';

// Regressão do bug de fuso (2026-07-03): uma data-calendário NÃO pode deslocar o dia entre
// fusos. Para o teste APANHAR mesmo o bug, correr sob TZ negativo:
//   TZ=America/Sao_Paulo node --test test/dia.test.mjs
// (com `new Date(stringUTC)` — o código antigo — estas asserções falhariam no Brasil.)

test('parseDia: data-only NÃO recua o dia (1-jul continua 1-jul)', () => {
  const d = parseDia('2026-07-01');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);   // julho (0-indexado)
  assert.equal(d.getDate(), 1);    // dia 1 — não 30-jun
});

test('parseDia: ISO com Z (meia-noite UTC) → fica o dia impresso, em qualquer fuso', () => {
  const d = parseDia('2026-07-01T00:00:00.000Z');
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 1);
});

test('parseDia: datetime com hora → só o dia', () => {
  const d = parseDia('2026-06-30 12:48:24');
  assert.equal(d.getMonth(), 5); // junho
  assert.equal(d.getDate(), 30);
});

test('parseDia: fim de ano não vira o ano', () => {
  const d = parseDia('2025-12-31T23:00:00.000Z');
  assert.equal(d.getFullYear(), 2025);
  assert.equal(d.getMonth(), 11);
  assert.equal(d.getDate(), 31);
});

test('parseDia: nulos/lixo → null', () => {
  assert.equal(parseDia(null), null);
  assert.equal(parseDia(''), null);
  assert.equal(parseDia('xxxx'), null);
});

// --- guard de plausibilidade da data da compra (caso real: foto cortada → ano 2023) ---
import { dataCompraSuspeita } from '../src/normaliza/dia.js';

test('dataCompraSuspeita: caso real 2023-08-07 fotografado em 2026-08-07 → SUSPEITA', () => {
  const r = dataCompraSuspeita('2023-08-07', '2026-08-07', 'vlm');
  assert.ok(r && /mal lido/.test(r), `esperado suspeita, obtido: ${r}`);
});

test('dataCompraSuspeita: talão de ontem fotografado hoje → OK', () => {
  assert.equal(dataCompraSuspeita('2026-08-06', '2026-08-07', 'vlm'), null);
});

test('dataCompraSuspeita: PDF antigo importado (ocr_llm) → OK, não sinaliza', () => {
  assert.equal(dataCompraSuspeita('2024-02-09', '2026-06-06', 'ocr_llm'), null);
});

test('dataCompraSuspeita: data no futuro → SUSPEITA', () => {
  const r = dataCompraSuspeita('2026-09-01', '2026-08-07', 'vlm');
  assert.ok(r && /FUTURO/.test(r));
});

test('dataCompraSuspeita: sem dados → null (não bloqueia)', () => {
  assert.equal(dataCompraSuspeita(null, '2026-08-07', 'vlm'), null);
});

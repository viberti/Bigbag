import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApresentacao, ehGenerico, precoPorDose, chaveEquivalencia } from '../src/normaliza/medicamento.js';

test('comprimido simples: dose, forma e quantidade', () => {
  const r = parseApresentacao('500 MG COM REV CT BL AL PLAS INC X 30');
  assert.equal(r.dose_valor, 500);
  assert.equal(r.dose_unidade, 'MG');
  assert.equal(r.forma, 'comprimido');
  assert.equal(r.qtd_embalagem, 30);
});

test('solução oral em gotas: força composta MG/ML e volume em ML', () => {
  const r = parseApresentacao('50 MG/ML SOL OR CT FR PLAS OPC GOT X 20 ML');
  assert.equal(r.dose_valor, 50);
  assert.equal(r.dose_unidade, 'MG/ML');
  assert.equal(r.forma, 'solução');
  assert.equal(r.qtd_embalagem, 20); // 20 ml
});

test('cápsula dura', () => {
  const r = parseApresentacao('20 MG CAP DURA CT BL AL AL X 28');
  assert.equal(r.dose_valor, 20);
  assert.equal(r.forma, 'cápsula');
  assert.equal(r.qtd_embalagem, 28);
});

test('combinação de princípios ativos preserva a dosagem inteira', () => {
  const r = parseApresentacao('500 MG + 200 MG COM REV CT BL AL PLAS INC X 30');
  assert.equal(r.dose_valor, 500); // 1.ª força para ordenar
  assert.equal(r.dosagem, '500 MG + 200 MG');
  assert.equal(r.forma, 'comprimido');
  assert.equal(r.qtd_embalagem, 30);
});

test('combo entre parênteses (Neosaldina): 1.ª força + forma + qtd', () => {
  const r = parseApresentacao('(600 + 60 + 60) MG COM REV CT BL AL PLAS X 100');
  assert.equal(r.dose_valor, 600);
  assert.equal(r.dose_unidade, 'MG');
  assert.equal(r.forma, 'comprimido');
  assert.equal(r.qtd_embalagem, 100);
});

test('combo líquido entre parênteses preserva MG/ML', () => {
  const r = parseApresentacao('(0,4 + 1) MG/ML XPE CT FR VD AMB X 50 ML');
  assert.equal(r.dose_valor, 0.4);
  assert.equal(r.dose_unidade, 'MG/ML');
  assert.equal(r.forma, 'xarope');
});

test('xarope com volume', () => {
  const r = parseApresentacao('100 MG/ML XPE CT FR PLAS AMB X 120 ML');
  assert.equal(r.forma, 'xarope');
  assert.equal(r.qtd_embalagem, 120);
});

test('múltiplos blisters multiplicam a quantidade', () => {
  const r = parseApresentacao('40 MG COM REV CT 2 BL AL PLAS INC X 14');
  assert.equal(r.qtd_embalagem, 28); // 2 × 14
});

test('creme dermatológico em gramas', () => {
  const r = parseApresentacao('10 MG/G CREM DERM CT BG AL X 30 G');
  assert.equal(r.forma, 'creme');
  assert.equal(r.qtd_embalagem, 30);
});

test('apresentação vazia/ilegível não rebenta', () => {
  const r = parseApresentacao('');
  assert.equal(r.forma, null);
  assert.equal(r.dose_valor, null);
  assert.equal(r.qtd_embalagem, null);
});

test('ehGenerico reconhece o tipo CMED', () => {
  assert.equal(ehGenerico('Genérico'), true);
  assert.equal(ehGenerico('GENERICO'), true);
  assert.equal(ehGenerico('Similar'), false);
  assert.equal(ehGenerico('Novo'), false);
  assert.equal(ehGenerico(null), false);
});

test('precoPorDose = preço / quantidade', () => {
  assert.equal(precoPorDose(30, 30), 1); // R$1,00 por comprimido
  assert.equal(precoPorDose(12.5, 20), 0.625);
  assert.equal(precoPorDose(10, 0), null);
  assert.equal(precoPorDose(null, 30), null);
});

test('chaveEquivalencia agrupa o mesmo remédio independentemente da marca', () => {
  const a = chaveEquivalencia({ substancia: 'Cloridrato de Metformina', dose_valor: 500, dose_unidade: 'MG', forma: 'comprimido' });
  const b = chaveEquivalencia({ substancia: 'cloridrato de metformina ', dose_valor: 500, dose_unidade: 'MG', forma: 'comprimido' });
  assert.equal(a, b);
});

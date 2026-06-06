// Decisão de unidade_base: formato determinístico vs. LLM, com guarda de
// categorias contadas (ovos, sabonete). Lógica pura — corre sem BD/LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirUnidadeBase } from '../src/normaliza/matcher.js';
import { extrairFormato } from '../src/normaliza/formato.js';

test('peso explícito ganha ao LLM: DIOSPIRO 350G → kg (não un)', () => {
  const c = { nome_canonico: 'Diospiro', categoria: 'Frutas', unidade_base: 'un' };
  assert.equal(decidirUnidadeBase(c, extrairFormato('DIOSPIRO MOLE 350 G')), 'kg');
});

test('multipack 4X125G é 500 g no total → kg', () => {
  const c = { nome_canonico: 'Iogurte Grego', categoria: 'Laticínios', unidade_base: 'un' };
  const fmt = extrairFormato('IOGURTE GREGO 4X125G');
  assert.equal(fmt.unidade_base, 'kg');
  assert.equal(fmt.formato_valor, 0.5);
  assert.equal(decidirUnidadeBase(c, fmt), 'kg');
});

test('volume explícito → L: CHAMPO 400ML', () => {
  const c = { nome_canonico: 'Champô', categoria: 'Higiene', unidade_base: 'un' };
  assert.equal(decidirUnidadeBase(c, extrairFormato('CHAMPO 400ML')), 'L');
});

test('guarda de contados: OVOS com calibre 53-63G → fica un', () => {
  const c = { nome_canonico: 'Ovos de Galinha M', categoria: 'Ovos', unidade_base: 'un' };
  const fmt = extrairFormato('OVOS M CLASSE 53-63G');
  assert.equal(fmt.unidade_base, 'kg'); // o parser apanha um peso...
  assert.equal(decidirUnidadeBase(c, fmt), 'un'); // ...mas a guarda mantém un
});

test('guarda de contados: SABONETE 90G → fica un', () => {
  const c = { nome_canonico: 'Sabonete Aloe', categoria: 'Higiene', unidade_base: 'un' };
  assert.equal(decidirUnidadeBase(c, extrairFormato('SABONETE 90G')), 'un');
});

test('sem peso/volume no formato → usa unidade do LLM', () => {
  const c = { nome_canonico: 'Escova de Dentes', categoria: 'Higiene', unidade_base: 'un' };
  assert.equal(decidirUnidadeBase(c, extrairFormato('ESCOVA DENTES MEDIA')), 'un');
});

test('fallback un quando não há formato nem LLM', () => {
  assert.equal(decidirUnidadeBase({}, extrairFormato('PRODUTO QUALQUER')), 'un');
});

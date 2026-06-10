import test from 'node:test';
import assert from 'node:assert/strict';
import { conteudoDeTexto } from '../src/normaliza/conteudo.js';

test('peso simples', () => {
  assert.deepEqual(conteudoDeTexto('1 kg'), { valor: 1, unidade: 'kg', pack: null });
  assert.deepEqual(conteudoDeTexto('425GR'), { valor: 0.425, unidade: 'kg', pack: null });
  assert.deepEqual(conteudoDeTexto('0.406 kg'), { valor: 0.406, unidade: 'kg', pack: null });
});

test('volume', () => {
  assert.deepEqual(conteudoDeTexto('1 l'), { valor: 1, unidade: 'L', pack: null });
  assert.deepEqual(conteudoDeTexto('200 ml'), { valor: 0.2, unidade: 'L', pack: null });
  assert.deepEqual(conteudoDeTexto('33 cl'), { valor: 0.33, unidade: 'L', pack: null });
});

test('multipack com contagem', () => {
  assert.deepEqual(conteudoDeTexto('4x125g'), { valor: 0.5, unidade: 'kg', pack: 4 });
  assert.deepEqual(conteudoDeTexto('6*1L'), { valor: 6, unidade: 'L', pack: 6 });
  assert.deepEqual(conteudoDeTexto('3 x 200 ml'), { valor: 0.6, unidade: 'L', pack: 3 });
});

test('contagem de unidades', () => {
  assert.deepEqual(conteudoDeTexto('45 Unidades'), { valor: 45, unidade: 'un', pack: null });
  assert.deepEqual(conteudoDeTexto('1un'), { valor: 1, unidade: 'un', pack: null });
  assert.deepEqual(conteudoDeTexto('16UN'), { valor: 16, unidade: 'un', pack: null });
  assert.deepEqual(conteudoDeTexto('2dz'), { valor: 24, unidade: 'un', pack: null });
  assert.deepEqual(conteudoDeTexto('12 ovos'), { valor: 12, unidade: 'un', pack: null });
});

test('peso escondido em parêntesis (escorrido)', () => {
  assert.deepEqual(conteudoDeTexto('250 (410 g)'), { valor: 0.41, unidade: 'kg', pack: null });
});

test('sem conteúdo explícito → null (nunca inventa)', () => {
  assert.equal(conteudoDeTexto(''), null);
  assert.equal(conteudoDeTexto(null), null);
  assert.equal(conteudoDeTexto('n/d'), null);
  assert.equal(conteudoDeTexto('grande'), null);
  assert.equal(conteudoDeTexto('12'), null); // número solto é ambíguo
});

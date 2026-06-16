import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marcaEhTipo } from '../src/normaliza/categoria.js';

test('rejeita TIPOS/genéricos PT-ES mal-metidos no campo marca', () => {
  for (const t of ['Leite', 'Iogurte', 'Bolacha', 'Água', 'Arroz']) {
    assert.equal(marcaEhTipo(t), true, `"${t}" devia ser tipo`);
  }
});

test('só palavra única — multi-palavra é tratada como marca (evita falso-positivo)', () => {
  // "Pingo Doce" (marca real) cairia em 'doces' por causa de "doce" → restringido a single-token.
  assert.equal(marcaEhTipo('Pingo Doce'), false);
  assert.equal(marcaEhTipo('Leite Magro'), false); // conservador: não apanha frases-tipo multi-palavra
});

test('mantém marcas REAIS (caem em "outros")', () => {
  for (const m of ['Nestlé', 'Allseasons', 'Ovomaltine', 'Continente', 'Pingo Doce', 'Compal']) {
    assert.equal(marcaEhTipo(m), false, `"${m}" é marca real`);
  }
});

test('vazio/nulo → false', () => {
  assert.equal(marcaEhTipo(''), false);
  assert.equal(marcaEhTipo(null), false);
});

test('LIMITE conhecido: genérico ESTRANGEIRO fora do vocabulário PT/ES não é apanhado aqui', () => {
  // 'Sauerkraut' (alemão) → grupoDeNome dá "outros" → este guard NÃO o apanha.
  // Apanhá-lo é o papel da blocklist por rácio do corpus (nome≫marca). Documentado de propósito.
  assert.equal(marcaEhTipo('Sauerkraut'), false);
});

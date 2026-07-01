import { test } from 'node:test';
import assert from 'node:assert/strict';
import { talaoSemValores } from '../src/ingest/talaoValores.js';

test('talão real (total > 0) → tem valores', () => {
  assert.equal(talaoSemValores({ total_impresso: 11.72, itens: [{ preco_liquido: 2 }] }), false);
});

test('total 0 mas há item com preço → tem valores (não bloqueia)', () => {
  // VLM às vezes não lê o total mas lê as linhas — não deve falhar.
  assert.equal(talaoSemValores({ total_impresso: 0, itens: [{ preco_liquido: 1.5 }] }), false);
});

test('resumo LidlPlus (total 0, itens a 0 €) → SEM valores', () => {
  assert.equal(talaoSemValores({
    total_impresso: 0,
    itens: [{ descricao_original: 'Salmão Fumado', preco_liquido: 0 }, { descricao_original: 'Limas', preco_liquido: 0 }],
  }), true);
});

test('total null e sem itens → SEM valores', () => {
  assert.equal(talaoSemValores({ total_impresso: null, itens: [] }), true);
});

test('dados ausentes → SEM valores', () => {
  assert.equal(talaoSemValores(null), true);
  assert.equal(talaoSemValores(undefined), true);
});

test('item não-produto com preço não conta (só cupão/rodapé) → SEM valores', () => {
  assert.equal(talaoSemValores({
    total_impresso: 0,
    itens: [{ descricao_original: 'TOTAL PONTOS', preco_liquido: 5, is_non_product: true }],
  }), true);
});

test('preço negativo (reembolso) não conta como valor positivo → SEM valores', () => {
  assert.equal(talaoSemValores({ total_impresso: 0, itens: [{ preco_liquido: -3 }] }), true);
});

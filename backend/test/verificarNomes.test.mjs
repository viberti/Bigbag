import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirNome } from '../src/ingest/verificarNomes.js';

test('duas leituras iguais → confirmado (normalização tolerante)', () => {
  assert.equal(decidirNome({ lido: 'SALADA RIVA', opiniao: 'Salada Riva' }).resultado, 'confirmado');
});

test('leituras divergem + catálogo confirma a opinião → corrigido', () => {
  const d = decidirNome({ lido: 'SALARA RISO', opiniao: 'SALADA RIVA', scoreLido: 0, scoreOpiniao: 1 });
  assert.equal(d.resultado, 'corrigido');
  assert.equal(d.nome, 'SALADA RIVA');
});

test('leituras divergem SEM confirmação do catálogo → fica o lido, em dúvida', () => {
  const d = decidirNome({ lido: 'SALARA RISO', opiniao: 'SALANA RIVO', scoreLido: 0, scoreOpiniao: 0.3 });
  assert.equal(d.resultado, 'duvida');
  assert.equal(d.nome, 'SALARA RISO');
});

test('opinião tem de ser CLARAMENTE melhor que o lido (margem 0.1)', () => {
  assert.equal(decidirNome({ lido: 'A', opiniao: 'B', scoreLido: 0.6, scoreOpiniao: 0.65 }).resultado, 'duvida');
});

test('sem 2.ª opinião (null) → dúvida, nunca inventa', () => {
  assert.equal(decidirNome({ lido: 'X', opiniao: null }).resultado, 'duvida');
  assert.equal(decidirNome({ lido: 'X', opiniao: 'null' }).resultado, 'duvida');
});

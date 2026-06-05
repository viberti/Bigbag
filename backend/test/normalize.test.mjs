import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarItens } from '../src/ingest/normalize.js';

test('dobra a linha POUPANCA no desconto_direto do item acima e remove-a', () => {
  const entrada = [
    { descricao_original: 'BOL MY COOKIES TRADICIONAL 150G', valor: 1.38, desconto_direto: 0 },
    { descricao_original: 'POUPANCA', valor: 0.47, desconto_direto: 0.47 },
    { descricao_original: 'COCO RALADO CNT 200G', valor: 1.99, desconto_direto: 0 },
  ];
  const out = normalizarItens(entrada);
  assert.equal(out.length, 2); // a linha-fantasma desaparece
  assert.equal(out[0].descricao_original, 'BOL MY COOKIES TRADICIONAL 150G');
  assert.equal(out[0].desconto_direto, 0.47); // dobrada no item acima
  assert.equal(out[1].descricao_original, 'COCO RALADO CNT 200G');
});

test('não mexe quando não há linhas de desconto', () => {
  const entrada = [{ descricao_original: 'MANTEIGA', valor: 1.99, desconto_direto: 0 }];
  const out = normalizarItens(entrada);
  assert.equal(out.length, 1);
  assert.equal(out[0].desconto_direto, 0);
});

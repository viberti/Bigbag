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

test('dobra a linha órfã de peso (Mercadona) no nome do item acima', () => {
  const entrada = [
    { descricao_original: '1 BANANA', valor: 1.81 },
    { descricao_original: '2,426 kg 1,20 EUR/kg', valor: 2.91 },
    { descricao_original: '1 BATATA VERMELHA', valor: 0 },
    { descricao_original: '0,816 kg 1,70 EUR/kg', valor: 1.39 },
  ];
  const out = normalizarItens(entrada);
  assert.equal(out.length, 2); // as linhas só-de-peso desaparecem
  assert.equal(out[0].descricao_original, '1 BANANA 2,426 kg 1,20 EUR/kg');
  assert.equal(out[0].valor, 2.91); // usa o total da linha de peso (não o 1,81 errado)
  assert.equal(out[1].descricao_original, '1 BATATA VERMELHA 0,816 kg 1,70 EUR/kg');
  assert.equal(out[1].valor, 1.39);
});

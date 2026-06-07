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

test('dobra a linha órfã de peso: nome fica LIMPO (sem prefixo de qtd), peso vai para linha_peso', () => {
  const entrada = [
    { descricao_original: '1 BANANA', valor: 1.81 },
    { descricao_original: '2,426 kg 1,20 EUR/kg', valor: 2.91 },
    { descricao_original: '1 BATATA VERMELHA', valor: 0 },
    { descricao_original: '0,816 kg 1,70 €/kg', valor: 1.39 }, // com símbolo €
  ];
  const out = normalizarItens(entrada);
  assert.equal(out.length, 2); // as linhas só-de-peso desaparecem
  assert.equal(out[0].descricao_original, 'BANANA'); // prefixo "1 " removido
  assert.equal(out[0].linha_peso, '2,426 kg 1,20 EUR/kg');
  assert.equal(out[0].valor, 2.91); // usa o total da linha de peso (não o 1,81 errado)
  assert.equal(out[1].descricao_original, 'BATATA VERMELHA');
  assert.equal(out[1].linha_peso, '0,816 kg 1,70 €/kg');
  assert.equal(out[1].valor, 1.39);
});

// Limpeza final: ruído que o RE_PESO_INLINE não apanha (prefixos, ordem Continente-PDF).
test('tira prefixo de quantidade e código IVA do nome', () => {
  const out = normalizarItens([
    { descricao_original: '1 MANAO PARTIDO', valor: 1.89 },
    { descricao_original: 'C BANANA IMPORTADA', valor: 1.35 },
    { descricao_original: '(A) IOG MYTHOS CNT COCO 4X115G', valor: 1.5 },
  ]);
  assert.equal(out[0].descricao_original, 'MANAO PARTIDO');
  assert.equal(out[1].descricao_original, 'BANANA IMPORTADA');
  assert.equal(out[2].descricao_original, 'IOG MYTHOS CNT COCO 4X115G'); // formato 4X115G fica (é identidade)
});
test('ordem Continente-PDF "B kg x1,056 1,19 EUR/kgEUR": nome limpo, peso preservado em linha_peso', () => {
  const out = normalizarItens([{ descricao_original: 'BANANA B kg x1,056 1,19 EUR/kgEUR', valor: 1.26 }]);
  assert.equal(out[0].descricao_original, 'BANANA');
  assert.ok(out[0].linha_peso && /1,056/.test(out[0].linha_peso)); // peso guardado → ppb recuperável num reprocesso
});
test('pack "MIRTILO 500 G" NÃO é tocado (tamanho de embalagem é identidade)', () => {
  const out = normalizarItens([{ descricao_original: 'MIRTILO 500 G', valor: 5.15 }]);
  assert.equal(out[0].descricao_original, 'MIRTILO 500 G');
});

// Caminho novo: VLM devolve peso/€-por-kg em campos próprios.
test('campos peso_kg + preco_base_impresso → reconstrói linha_peso, nome fica limpo', () => {
  const out = normalizarItens([
    { descricao_original: 'MAÇÃ ROYAL GALA', peso_kg: 0.618, preco_base_impresso: 3.59, valor: 2.22 },
  ]);
  assert.equal(out[0].descricao_original, 'MAÇÃ ROYAL GALA');
  assert.equal(out[0].linha_peso, '0,618 kg x 3,59 EUR/kg');
});
test('peso_kg sem €/kg impresso → linha_peso só com o peso', () => {
  const out = normalizarItens([{ descricao_original: 'BANANA', peso_kg: 2.88, preco_base_impresso: null, valor: 3.46 }]);
  assert.equal(out[0].linha_peso, '2,88 kg');
});

test('peso colado ao nome (inline/\\n) é separado para linha_peso', () => {
  const out = normalizarItens([{ descricao_original: 'BANANA\n1,800 kg x 1,19 EUR/kg', valor: 2.14 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].descricao_original, 'BANANA');
  assert.equal(out[0].linha_peso, '1,800 kg x 1,19 EUR/kg');
});

test('peso sem unidades colado ao nome ("1,170 X 1,29") é separado', () => {
  const out = normalizarItens([{ descricao_original: 'BANANA 1,170 X 1,29', valor: 1.51 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].descricao_original, 'BANANA');
  assert.equal(out[0].linha_peso, '1,170 X 1,29');
});

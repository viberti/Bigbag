import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensIdentidade, construirNuvem, pontuar } from '../src/normaliza/nuvem.js';

test('expande abreviaturas e tira ruído (qj→queijo, fat→fatiado, cnt/200g fora)', () => {
  assert.deepEqual(tokensIdentidade('QJ GOUDA FAT PD 200G'), ['queijo', 'gouda', 'fatiado']);
  assert.deepEqual(tokensIdentidade('BATATA VERMELHA CNT KG'), ['batata', 'vermelha']);
});
test('NÃO remove "doce" (colide com Pingo Doce mas é produto)', () => {
  assert.deepEqual(tokensIdentidade('DOCE DE LEITE'), ['doce', 'leite']);
});
test('caso gouda: "fatias" encaixa no fatiado, não no bloco', () => {
  const docs = new Map([
    [1, ['QUEIJO GOUDA', 'GOUDA OLD HOLLAND']], // bloco
    [2, ['QUEIJO GOUDA EM FATIAS', 'QJ GOUDA FAT PD 200G']], // fatiado
    [3, ['LEITE MEIO GORDO']], // ruído
  ]);
  const nuvem = construirNuvem(docs);
  const r = pontuar('QUEIJO GOUDA FATIAS', nuvem);
  assert.equal(r[0].sku, 2); // fatiado ganha (token "fatiado" discrimina)
  const b = pontuar('QUEIJO GOUDA', nuvem);
  assert.equal(b[0].sku, 1); // bloco ganha p/ a descrição sem apresentação
});

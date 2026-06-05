// Testa a reconciliação com os números reais da fatura Continente Braga
// (22/05/2026): subtotal 43,06, Desconto Cartão 4,96, TOTAL A PAGAR 38,10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distribuirDesconto } from '../src/ingest/reconcile.js';

const valores = [
  0.99, 1.38, 1.39, 1.99, 3.99, 1.89, 1.69, 1.99, 1.51, 0.99, 2.98, 4.69, 1.79, 0.99, 1.19, 1.34, 1.29, 1.99, 8.99,
];
const itens = valores.map((valor, i) => ({ valor, descricao_original: `item ${i}` }));

test('soma dos líquidos bate com o TOTAL A PAGAR ao cêntimo', () => {
  const r = distribuirDesconto(itens, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  assert.equal(Math.round(r.subtotal * 100), 4306); // 43,06
  assert.equal(Math.round(r.totalReconciliado * 100), 3810); // 38,10 exato
  assert.equal(r.extracaoBate, true); // 43,06 - 4,96 == 38,10
  assert.equal(r.discrepancia, 0);
});

test('discrepância apanha um item-fantasma (ex. POUPANCA 0,47 a mais)', () => {
  const comFantasma = [...valores, 0.47].map((valor) => ({ valor }));
  const r = distribuirDesconto(comFantasma, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  assert.equal(r.discrepancia, 0.47); // 43,53 - 4,96 - 38,10
  assert.equal(r.extracaoBate, false);
});

test('cada líquido é <= ao preço impresso (desconto reduz)', () => {
  const r = distribuirDesconto(itens, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  for (const it of r.itens) {
    assert.ok(it.preco_liquido <= it.preco_unitario + 1e-9, `${it.descricao_original}: liquido > unitario`);
    assert.ok(it.preco_liquido > 0);
  }
});

test('todos os líquidos têm 2 casas decimais (cêntimos inteiros)', () => {
  const r = distribuirDesconto(itens, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  for (const it of r.itens) {
    const cents = it.preco_liquido * 100;
    assert.ok(Math.abs(cents - Math.round(cents)) < 1e-6, `${it.descricao_original}: não é cêntimo inteiro`);
  }
});

test('sem desconto global, líquido = impresso', () => {
  const r = distribuirDesconto([{ valor: 2.5 }, { valor: 1.5 }], { descontoGlobal: 0, totalImpresso: 4.0 });
  assert.equal(r.itens[0].preco_liquido, 2.5);
  assert.equal(r.itens[1].preco_liquido, 1.5);
  assert.equal(r.extracaoBate, true);
});

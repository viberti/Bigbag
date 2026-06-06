// Testa a reconciliação com os números reais da fatura Continente Braga
// (22/05/2026): subtotal 43,06, Desconto Cartão 4,96, TOTAL A PAGAR 38,10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distribuirDesconto, pistaCirurgica, validarLinhas } from '../src/ingest/reconcile.js';

const valores = [
  0.99, 1.38, 1.39, 1.99, 3.99, 1.89, 1.69, 1.99, 1.51, 0.99, 2.98, 4.69, 1.79, 0.99, 1.19, 1.34, 1.29, 1.99, 8.99,
];
const itens = valores.map((valor, i) => ({ valor, descricao_original: `item ${i}` }));

test('total reconciliado = subtotal − desconto global = TOTAL A PAGAR', () => {
  const r = distribuirDesconto(itens, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  assert.equal(Math.round(r.subtotal * 100), 4306); // 43,06
  assert.equal(Math.round(r.totalReconciliado * 100), 3810); // 38,10 exato
  assert.equal(r.extracaoBate, true); // 43,06 - 4,96 == 38,10
  assert.equal(r.discrepancia, 0);
  // o desconto de cartão NÃO é espalhado pelos itens: cada líquido fica fiel ao
  // impresso, logo a soma dos líquidos é o SUBTOTAL (43,06), não o total.
  assert.equal(Math.round(r.itens.reduce((s, it) => s + it.preco_liquido, 0) * 100), 4306);
});

test('discrepância apanha um item-fantasma (ex. POUPANCA 0,47 a mais)', () => {
  const comFantasma = [...valores, 0.47].map((valor) => ({ valor }));
  const r = distribuirDesconto(comFantasma, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  assert.equal(r.discrepancia, 0.47); // 43,53 - 4,96 - 38,10
  assert.equal(r.extracaoBate, false);
});

test('desconto global (cartão) NÃO é espalhado: cada líquido = impresso', () => {
  const r = distribuirDesconto(itens, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  r.itens.forEach((it, i) => {
    assert.equal(it.preco_liquido, valores[i]); // fiel ao impresso, sem raspar cêntimos
    assert.ok(it.preco_liquido > 0);
  });
});

test('todos os líquidos têm 2 casas decimais (cêntimos inteiros)', () => {
  const r = distribuirDesconto(itens, { descontoGlobal: 4.96, totalImpresso: 38.1 });
  for (const it of r.itens) {
    const cents = it.preco_liquido * 100;
    assert.ok(Math.abs(cents - Math.round(cents)) < 1e-6, `${it.descricao_original}: não é cêntimo inteiro`);
  }
});

test('LIDL: valor bruto + desconto de linha (convenção B), total 64,70', () => {
  // (valor bruto, desconto_direto) reais da fatura Lidl Braga 2026-05-28
  const lidl = [
    [3.13, 0.2], [3.25, 0.2], [2.87, 0.18], [0.79, 0], [1.99, 0], [0.99, 0], [1.19, 0],
    [6.29, 1.3], [2.19, 0], [1.29, 0], [0.95, 0], [4.79, 0], [5.79, 0], [4.99, 1.0],
    [1.49, 0], [1.89, 0], [2.45, 0], [2.39, 0], [3.85, 0], [5.39, 0], [5.99, 1.0],
    [2.79, 0.3], [2.14, 0],
  ].map(([valor, desconto_direto]) => ({ valor, desconto_direto }));
  const r = distribuirDesconto(lidl, { descontoGlobal: 0, totalImpresso: 64.7 });
  assert.equal(r.convencao, 'B'); // valor é bruto, desconto real
  assert.equal(r.discrepancia, 0);
  assert.equal(r.extracaoBate, true);
  assert.equal(Math.round(r.totalReconciliado * 100), 6470);
  assert.equal(r.itens[0].preco_unitario, 3.13); // bruto preservado
  assert.equal(r.itens[0].preco_liquido, 2.93); // 3,13 − 0,20
});

test('sem desconto, diferença de extração NÃO rapa cêntimos (preço fiel ao impresso)', () => {
  // 3,49 + 2,29 + 3,59 = 9,37 impresso, mas total da nota 9,27 (0,10 a menos)
  const itens = [{ valor: 3.49 }, { valor: 2.29 }, { valor: 3.59 }];
  const r = distribuirDesconto(itens, { descontoGlobal: 0, totalImpresso: 9.27 });
  assert.equal(r.itens[0].preco_liquido, 3.49); // mantém o impresso
  assert.equal(r.itens[1].preco_liquido, 2.29);
  assert.equal(r.itens[2].preco_liquido, 3.59);
  assert.equal(r.discrepancia, 0.1); // diferença sinalizada
  assert.equal(r.extracaoBate, false);
});

test('sem desconto global, líquido = impresso', () => {
  const r = distribuirDesconto([{ valor: 2.5 }, { valor: 1.5 }], { descontoGlobal: 0, totalImpresso: 4.0 });
  assert.equal(r.itens[0].preco_liquido, 2.5);
  assert.equal(r.itens[1].preco_liquido, 1.5);
  assert.equal(r.extracaoBate, true);
});

test('IVA de grossista (Makro): linhas sem IVA + IVA somado no fim → bate', () => {
  // Makro #140: Σ linhas (s/IVA) = 49,12; IVA somado = 7,77; Valor Total = 56,89.
  const itens = [{ valor: 30 }, { valor: 19.12 }];
  const r = distribuirDesconto(itens, { descontoGlobal: 0, totalImpresso: 56.89, iva: 7.77 });
  assert.equal(r.extracaoBate, true);
  assert.equal(r.discrepancia, 0);
  assert.equal(Math.round(r.totalReconciliado * 100), 5689); // 56,89
  assert.equal(r.itens[0].preco_liquido, 30); // preço da linha (s/IVA), não inflado pelo IVA
});

test('sem iva (talão normal): fórmula inalterada', () => {
  const r = distribuirDesconto([{ valor: 2.5 }, { valor: 1.5 }], { descontoGlobal: 0, totalImpresso: 4.0 });
  assert.equal(r.extracaoBate, true);
  assert.equal(r.discrepancia, 0);
});

test('validarLinhas: multipack correto (2×0,59=1,18) → sem flag', () => {
  assert.equal(validarLinhas([{ quantidade: 2, preco_unitario: 0.59, valor: 1.18, descricao_original: 'X' }]).length, 0);
});

test('validarLinhas: multipack mal lido (valor=unitário) → flag com o esperado', () => {
  const fora = validarLinhas([{ quantidade: 2, preco_unitario: 0.59, valor: 0.59, descricao_original: 'SAB.JASMIM' }]);
  assert.equal(fora.length, 1);
  assert.equal(fora[0].esperado, 1.18);
  assert.match(fora[0].descricao, /SAB\.JASMIM/);
});

test('validarLinhas: grossista (3×2,59=7,77) correto → sem flag', () => {
  assert.equal(validarLinhas([{ quantidade: 3, preco_unitario: 2.59, valor: 7.77, descricao_original: 'PASSATA' }]).length, 0);
});

test('validarLinhas: qtd 1 ou sem unitário → não verifica (sem falsos positivos)', () => {
  assert.equal(validarLinhas([{ quantidade: 1, preco_unitario: 2.5, valor: 2.5 }]).length, 0);
  assert.equal(validarLinhas([{ quantidade: 2, preco_unitario: null, valor: 5 }]).length, 0);
});

test('pistaCirurgica: bate → sem pista', () => {
  assert.equal(pistaCirurgica([{ valor: 2.5, descricao_original: 'X' }], 0), '');
});

test('pistaCirurgica: diferença = valor de um item (d<0 → pode FALTAR, nomeia)', () => {
  const itens = [{ valor: 7.77, descricao_original: 'ARROZ ARO 5KG' }, { valor: 2.0, descricao_original: 'Y' }];
  const p = pistaCirurgica(itens, -7.77);
  assert.match(p, /ARROZ ARO 5KG/);
  assert.match(p, /FALTAR|menos/);
});

test('pistaCirurgica: diferença = valor de um item (d>0 → DUPLICADO)', () => {
  const p = pistaCirurgica([{ valor: 3.49, descricao_original: 'LEITE' }], 3.49);
  assert.match(p, /LEITE/);
  assert.match(p, /DUPLICADO|duas vezes/);
});

test('pistaCirurgica: diferença = desconto de linha → aponta o desconto', () => {
  const itens = [{ valor: 4.19, desconto_direto: 0.8, descricao_original: 'IOGURTE' }];
  const p = pistaCirurgica(itens, -0.8);
  assert.match(p, /IOGURTE/);
  assert.match(p, /desconto/i);
});

test('pistaCirurgica: sem casamento → só direção (ABAIXO menciona quantidade/pack)', () => {
  const p = pistaCirurgica([{ valor: 5.0, descricao_original: 'X' }], -7.77);
  assert.match(p, /ABAIXO/);
  assert.match(p, /QUANTIDADE|pack|FALTA/);
});

test('iva ESPÚRIO (legenda lida como IVA-somado) é ignorado: supermercado', () => {
  // 3 itens somam 10,00 = total (preços já com IVA); o LLM mandou iva=0,57
  // (a tabela informativa). O guarda deve zerá-lo → discrepância 0.
  const its = [{ valor: 3 }, { valor: 4 }, { valor: 3 }].map((x, i) => ({ ...x, descricao_original: `i${i}` }));
  const r = distribuirDesconto(its, { descontoGlobal: 0, totalImpresso: 10, iva: 0.57 });
  assert.equal(r.iva, 0); // espúrio → zerado
  assert.equal(r.discrepancia, 0);
});

test('iva REAL de grossista é mantido: linhas sem IVA + IVA somado = total', () => {
  // linhas somam 10,00 (sem IVA); IVA 0,60 somado → total 10,60. O guarda
  // deve MANTER o iva (somá-lo aproxima do total).
  const its = [{ valor: 4 }, { valor: 6 }].map((x, i) => ({ ...x, descricao_original: `i${i}` }));
  const r = distribuirDesconto(its, { descontoGlobal: 0, totalImpresso: 10.6, iva: 0.6 });
  assert.equal(r.iva, 0.6); // mantido
  assert.equal(r.discrepancia, 0);
});

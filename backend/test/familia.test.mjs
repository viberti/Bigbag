import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familiaPorNome, FAMILIAS, familia } from '../src/normaliza/familia.js';

test('cada família tem roll-ups completos (dep/grupo/seccao/unidade)', () => {
  for (const [slug, f] of Object.entries(FAMILIAS)) {
    assert.ok(f.label, `${slug} sem label`);
    assert.ok(['food', 'non_food'].includes(f.dep), `${slug} dep inválido`);
    assert.ok(f.grupo && f.seccao && f.unidade, `${slug} sem roll-ups`);
  }
});

test('massa — formatos variados (reusa TIPOS_NOME)', () => {
  for (const n of ['Esparguete', 'Penne Rigate', 'Massa Cotovelos', 'Gnocchi de Batata', 'Cuscuz', 'Lasanha', 'Talharim'])
    assert.equal(familiaPorNome(n), 'massa', n);
});

test('massa por MARCA quando o nome é estranho (homónimo resolvido por outra via no fusor)', () => {
  // "Pérolas" sozinho NÃO casa (é o caso difícil — vem do VLM/categoria no fusor)
  assert.equal(familiaPorNome('Pérolas'), null);
  // mas se a marca é de massa, resolve
  assert.equal(familiaPorNome('Pérolas', 'Pasta Berruto'), 'massa');
});

test('arroz', () => {
  for (const n of ['Arroz Basmati', 'Arroz Agulha Extra Longo', 'Arroz Carolino', 'Risotto Arborio'])
    assert.equal(familiaPorNome(n), 'arroz', n);
});

test('conservas de peixe (natureza=peixe, a tensão das anchovas)', () => {
  for (const n of ['Atum em Óleo Vegetal', 'Filetes de Anchovas em Óleo de Girassol', 'Sardinhas em Tomate', 'Cavala em Azeite'])
    assert.equal(familiaPorNome(n), 'conservas_peixe', n);
  assert.equal(familia('conservas_peixe').natureza, 'peixe'); // a 2.ª lente
});

test('conservas vegetais vs leguminosas vs molhos (colisões controladas)', () => {
  assert.equal(familiaPorNome('Milho Doce em Lata'), 'conservas_vegetais');
  assert.equal(familiaPorNome('Tomate Pelado'), 'conservas_vegetais');
  assert.equal(familiaPorNome('Polpa de Tomate'), 'conservas_vegetais');
  assert.equal(familiaPorNome('Feijão Preto'), 'leguminosas');
  assert.equal(familiaPorNome('Grão de Bico Cozido'), 'leguminosas');
  assert.equal(familiaPorNome('Molho de Tomate Frito'), 'molhos_condimentos'); // "molho" vence
  assert.equal(familiaPorNome('Ketchup'), 'molhos_condimentos');
});

test('azeite/óleo, especiarias, farinha/açúcar', () => {
  assert.equal(familiaPorNome('Azeite Virgem Extra'), 'azeite_oleo');
  assert.equal(familiaPorNome('Óleo de Girassol'), 'azeite_oleo');
  assert.equal(familiaPorNome('Sal Fino Marinho'), 'especiarias');
  assert.equal(familiaPorNome('Orégãos'), 'especiarias');
  assert.equal(familiaPorNome('Farinha de Trigo T55'), 'farinha_acucar');
  assert.equal(familiaPorNome('Açúcar Branco 1kg'), 'farinha_acucar');
});

test('cereais de pequeno-almoço', () => {
  for (const n of ['Cereais de Chocolate', 'Muesli de Frutas', 'Flocos de Aveia'])
    assert.equal(familiaPorNome(n), 'cereais_pa', n);
});

test('café, chá e infusões (família acrescentada após a cobertura)', () => {
  for (const n of ['Café Delta Solúvel Descafeinado', 'Café Nescafé Gold 100g', 'Chá Verde 20 Saquetas', 'Infusão de Camomila'])
    assert.equal(familiaPorNome(n), 'cafe_cha', n);
});

test('conservas_vegetais estendidas: azeitonas, pickles, fruta em calda', () => {
  assert.equal(familiaPorNome('Azeitona Verde Inteira Manzanilha'), 'conservas_vegetais');
  assert.equal(familiaPorNome('Pickles Ferbar em Vinagre'), 'conservas_vegetais');
  assert.equal(familiaPorNome('Pêssego em Calda'), 'conservas_vegetais');
});

test('fora do ramo / desconhecido → null', () => {
  assert.equal(familiaPorNome('Produto Misterioso XYZ'), null);
  assert.equal(familiaPorNome(''), null);
});

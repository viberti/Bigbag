import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familiaPorNome, FAMILIAS, familia, familiaDe } from '../src/normaliza/familia.js';

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

// ── FASE 2: famílias fora da mercearia (laticínios, doces, bebidas) ───────────
test('laticínios: iogurte / queijo / leite / manteiga / natas / requeijão', () => {
  for (const n of ['Iogurte Grego Natural', 'Skyr Proteico', 'Iogurte Líquido Morango']) assert.equal(familiaPorNome(n), 'iogurte', n);
  for (const n of ['Queijo Flamengo Fatias', 'Mozzarella Ralada', 'Queijo Gouda']) assert.equal(familiaPorNome(n), 'queijo', n);
  assert.equal(familiaPorNome('Leite Meio Gordo'), 'leite');
  for (const n of ['Manteiga com Sal', 'Margarina Vegetal']) assert.equal(familiaPorNome(n), 'manteiga', n);
  for (const n of ['Natas para Cozinhar', 'Creme de Leite']) assert.equal(familiaPorNome(n), 'natas', n);
  for (const n of ['Requeijão Light', 'Ricotta']) assert.equal(familiaPorNome(n), 'requeijao', n);
});

test('doces: chocolate / bolacha / cacau / gelado / compota — leftmost desambigua', () => {
  for (const n of ['Chocolate Negro 70%', 'Tablete Chocolate Leite', 'Bombons Sortidos']) assert.equal(familiaPorNome(n), 'chocolate', n);
  // bolacha/biscoito DE chocolate → bolacha (cabeça vence o chocolate)
  for (const n of ['Bolacha Maria', 'Biscoito de Chocolate', 'Cookies de Aveia']) assert.equal(familiaPorNome(n), 'bolacha', n);
  // achocolatado / Nesquik → cacau, não chocolate
  for (const n of ['Achocolatado em Pó', 'Bebida de Chocolate Solúvel Nesquik', 'Cacau em Pó', 'Nescau']) assert.equal(familiaPorNome(n), 'cacau', n);
  for (const n of ['Gelado de Baunilha', 'Gelado de Chocolate']) assert.equal(familiaPorNome(n), 'gelado', n);
  for (const n of ['Compota de Morango', 'Marmelada']) assert.equal(familiaPorNome(n), 'doce_compota', n);
  // bolo/torta — a CABEÇA vence o "cacau" do sabor (caso real: alternativas do Nesquik)
  for (const n of ['Torta Dancake com Cobertura Cacau e Leite', 'Bolo de Chocolate', 'Madalenas', 'Muffin de Chocolate']) assert.equal(familiaPorNome(n), 'bolo', n);
});

test('bebidas: cerveja / vinho / sumo / refrigerante / água', () => {
  for (const n of ['Cerveja Super Bock', 'Cerveja IPA Artesanal']) assert.equal(familiaPorNome(n), 'cerveja', n);
  for (const n of ['Vinho Tinto Reserva', 'Vinho do Porto Tawny']) assert.equal(familiaPorNome(n), 'vinho', n);
  for (const n of ['Sumo de Laranja', 'Néctar de Pêssego']) assert.equal(familiaPorNome(n), 'sumo', n);
  for (const n of ['Coca-Cola Zero', 'Ice Tea Limão']) assert.equal(familiaPorNome(n), 'refrigerante', n);
  assert.equal(familiaPorNome('Água Mineral com Gás'), 'agua');
});

test('COLISÕES leftmost: ingrediente no meio do nome NÃO rouba a cabeça', () => {
  assert.equal(familiaPorNome('Bolacha de Água e Sal'), 'bolacha');     // não 'especiarias'
  assert.equal(familiaPorNome('Queijo com Azeite e Sal'), 'queijo');    // não 'azeite_oleo'/'especiarias'
  assert.equal(familiaPorNome('Molho de Tomate Frito'), 'molhos_condimentos'); // 'molho' é a cabeça
  assert.equal(familiaPorNome('Atum em Óleo Vegetal'), 'conservas_peixe');     // 'atum' é a cabeça
});

test('fora do ramo / desconhecido → null', () => {
  assert.equal(familiaPorNome('Produto Misterioso XYZ'), null);
  assert.equal(familiaPorNome(''), null);
});

// ── familiaDe: o fusor de família (nome + categoria + VLM-tipo) ───────────────
test('familiaDe: o caso PÉROLAS — nome falha, categoria/VLM-tipo resgatam', () => {
  // nome sozinho → null (homónimo)
  assert.equal(familiaDe({ nome: 'Pérolas', marca: 'Hacendado' }).familia, null);
  // + categoria OFF "Massas secas" → massa
  assert.equal(familiaDe({ nome: 'Pérolas', categoria: 'Massas secas' }).familia, 'massa');
  // + VLM-tipo "massa alimentícia" → massa (e regista a via)
  const r = familiaDe({ nome: 'Pérolas', tipoTexto: 'massa alimentícia de qualidade superior' });
  assert.equal(r.familia, 'massa');
  assert.equal(r.via, 'vlm-tipo');
});

test('familiaDe: nome forte concorda com categoria → vence claro', () => {
  assert.equal(familiaDe({ nome: 'Esparguete Integral', categoria: 'Massa' }).familia, 'massa');
});

test('familiaDe: categoria COMPOSTA abstém-se, o nome decide', () => {
  // "Arroz e Massa" casa 2 famílias → não vota; o nome "Esparguete" decide
  assert.equal(familiaDe({ nome: 'Esparguete', categoria: 'Arroz e Massa' }).familia, 'massa');
});

test('familiaDe: sem sinais úteis → null', () => {
  assert.equal(familiaDe({ nome: 'Misterioso XYZ' }).familia, null);
});

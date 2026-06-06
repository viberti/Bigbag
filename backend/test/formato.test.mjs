import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';
import { expandirAbreviaturas, separarCadeia } from '../src/normaliza/abreviaturas.js';

test('formato simples em gramas → kg', () => {
  const f = extrairFormato('BOL DIGESTIVE AVEIA CNT 425GR');
  assert.equal(f.unidade_base, 'kg');
  assert.equal(f.formato_valor, 0.425);
  assert.equal(precoPorBase({ preco_liquido: 1.39 }, f), 3.2706); // 1,39 / 0,425
});

test('manteiga 250g → €/kg', () => {
  const f = extrairFormato('MANTEIGA C/ SAL CONTINENTE 250G');
  assert.equal(f.formato_valor, 0.25);
  assert.equal(precoPorBase({ preco_liquido: 1.99 }, f), 7.96);
});

test('multipack 4X115G → 0,46 kg', () => {
  const f = extrairFormato('IOG MYTHOS CNT COCO 4X115G');
  assert.equal(f.unidade_base, 'kg');
  assert.equal(f.formato_valor, 0.46);
});

test('item a peso com €/kg impresso usa o valor da fatura', () => {
  const f = extrairFormato('LOMBINHOS DE FRANGO 0,540 kg x 6,19 EUR/kg');
  assert.equal(f.unidade_base, 'kg');
  assert.equal(f.quantidadeKg, 0.54);
  assert.equal(precoPorBase({ preco_liquido: 3.34, quantidade: 1 }, f), 6.19);
});

test('item a peso com símbolo € e sem "x" (Mercadona): "2,426 kg 1,20 €/kg"', () => {
  const f = extrairFormato('BANANA 2,426 kg 1,20 €/kg');
  assert.equal(f.unidade_base, 'kg');
  assert.equal(f.quantidadeKg, 2.426);
  assert.equal(f.precoKg, 1.2);
  assert.equal(precoPorBase({ preco_liquido: 2.91, quantidade: 1 }, f), 1.2);
});

test('"2K" no arroz = 2 kg → €/kg', () => {
  const f = extrairFormato('ARO ARROZ LONGO COMUM 2K');
  assert.equal(f.unidade_base, 'kg');
  assert.equal(f.formato_valor, 2);
  assert.equal(precoPorBase({ preco_liquido: 2.5 }, f), 1.25); // 2,50 / 2 kg
});

test('"1,5K" → 1,5 kg; "1LT" → 1 L; não confunde "330 ML"', () => {
  assert.equal(extrairFormato('FEIJAO PRETO 1,5K').formato_valor, 1.5);
  assert.equal(extrairFormato('LEITE UHT 1LT').unidade_base, 'L');
  const ml = extrairFormato('AGUA 330 ML');
  assert.equal(ml.unidade_base, 'L');
  assert.equal(ml.formato_valor, 0.33);
});

test('peso sem unidades "1,170 X 1,29" → kg × €/kg', () => {
  const f = extrairFormato('BANANA 1,170 X 1,29');
  assert.equal(f.unidade_base, 'kg');
  assert.equal(f.quantidadeKg, 1.17);
  assert.equal(f.precoKg, 1.29);
});

test('multipack "4X115G" NÃO é confundido com peso sem unidades', () => {
  const f = extrairFormato('IOG MYTHOS CNT COCO 4X115G');
  assert.equal(f.formato_valor, 0.46); // continua multipack → 0,46 kg
});

test('unidades: 16UN → €/unidade individual', () => {
  const f = extrairFormato('CREPES CONTINENTE SIMPLES 16UN');
  assert.equal(f.unidade_base, 'un');
  assert.equal(f.formato_valor, 16);
  assert.equal(precoPorBase({ preco_liquido: 3.99 }, f), 0.2494); // 3,99/16
});

test('sem formato → unidade, €/un = líquido', () => {
  const f = extrairFormato('NATAS PARA CULINARIA');
  assert.equal(f.unidade_base, 'un');
  assert.equal(precoPorBase({ preco_liquido: 0.79 }, f), 0.79);
});

test('volume em litros', () => {
  const f = extrairFormato('AZEITE VR SELECÇÃO PT 0,75L');
  assert.equal(f.unidade_base, 'L');
  assert.equal(f.formato_valor, 0.75);
  assert.equal(precoPorBase({ preco_liquido: 5.39 }, f), 7.1867);
});

test('expandir abreviaturas e separar cadeia', () => {
  assert.equal(expandirAbreviaturas('BOL DIGESTIVE AVEIA'), 'Bolacha DIGESTIVE AVEIA');
  assert.equal(expandirAbreviaturas('QJ MOZZARELLA'), 'Queijo MOZZARELLA');
  assert.equal(expandirAbreviaturas('MANTEIGA C/ SAL'), 'MANTEIGA com SAL');
  const sep = separarCadeia('MANTEIGA C/ SAL CONTINENTE 250G');
  assert.equal(sep.cadeiaToken, 'CONTINENTE');
  assert.ok(!/CONTINENTE/.test(sep.semCadeia));
});

test('precoPorBase com alvo do SKU: café 250g + alvo kg → €/kg', () => {
  const f = extrairFormato('CAFE LOTE CAFET M GROS CNT 250G');
  assert.equal(f.unidade_base, 'kg');
  assert.equal(precoPorBase({ preco_liquido: 2.91 }, f, 'kg'), 11.64); // 2,91 / 0,25
});

test('precoPorBase com alvo kg mas SEM peso na descrição → null (honesto)', () => {
  const f = extrairFormato('CAFE NOIDO ENCORPADO'); // sem peso
  assert.equal(precoPorBase({ preco_liquido: 2.95 }, f, 'kg'), null);
});

test('precoPorBase com alvo un + contagem do pacote (18UN) → €/unidade', () => {
  const f = extrairFormato('OVOS SOLO CLASSE M/L CNT 18UN');
  assert.equal(precoPorBase({ preco_liquido: 4.79, quantidade: 1 }, f, 'un'), 0.2661); // 4,79 / 18
});

test('precoPorBase sem alvo = comportamento antigo (usa a unidade do formato)', () => {
  const f = extrairFormato('BOL DIGESTIVE AVEIA CNT 425GR');
  assert.equal(precoPorBase({ preco_liquido: 1.39 }, f), precoPorBase({ preco_liquido: 1.39 }, f, 'kg'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeCondizGemeo } from '../src/normaliza/resolverPorNome.js';

test('SUPRIME o gémeo errado quando só a marca (genérica) coincide — caso real Sauerkraut', () => {
  // marca mal-extraída ('Sauerkraut' = chucrute, não marca); o produto é 'Allseasons'.
  assert.equal(nomeCondizGemeo({
    nome: 'Allseasons', marca: 'Sauerkraut', termos: null,
    candNome: 'Delikatess Sauerkraut von Spreewald Prinzessin',
  }), false);
});

test('MANTÉM o Ovomaltine quando o VLM dá o termo discriminativo', () => {
  assert.equal(nomeCondizGemeo({
    nome: 'Fortificante Ovomaltine 400g', marca: 'Ovomaltine', termos: ['achocolatado'],
    candNome: 'Achocolatado em pó Ovomaltine',
  }), true);
});

test('SEM termo e só a marca a coincidir → não propõe (a foto é o caminho)', () => {
  // sem o termo do VLM, "Fortificante" não bate "Achocolatado" → suprime (seguro)
  assert.equal(nomeCondizGemeo({
    nome: 'Fortificante Ovomaltine 400g', marca: 'Ovomaltine', termos: null,
    candNome: 'Achocolatado em pó Ovomaltine',
  }), false);
});

test('positivo legítimo: nomes partilham o substantivo (fora da marca)', () => {
  assert.equal(nomeCondizGemeo({
    nome: 'Bolacha Maria Águia', marca: 'Águia', termos: null,
    candNome: 'Bolacha Maria Integral Águia',
  }), true); // partilham "bolacha"/"maria"
});

test('o token da MARCA sozinho não conta (senão tudo passaria)', () => {
  assert.equal(nomeCondizGemeo({
    nome: 'Águia', marca: 'Águia', termos: null, candNome: 'Salt Plus Águia',
  }), false); // só a marca em comum → não propõe
});

test('mono-marca legítima: nome = marca e candidato = marca (+tamanho) → propõe', () => {
  assert.equal(nomeCondizGemeo({
    nome: 'Nutella', marca: 'Nutella', termos: null, candNome: 'Nutella 400g',
  }), true);
});

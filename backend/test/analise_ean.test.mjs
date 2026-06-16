import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paisDoEan, eanInterno, eanValido, analiseEan } from '../src/normaliza/ean.js';

test('país por prefixo GS1 (casos reais do fusor)', () => {
  assert.equal(paisDoEan('5601151979969').iso, 'PT'); // Compal PT
  assert.equal(paisDoEan('7896089011357').iso, 'BR'); // Pilão BR
  assert.equal(paisDoEan('8480000062857').iso, 'ES'); // Pérolas (Mercadona ES)
  assert.equal(paisDoEan('7613039766538').iso, 'CH'); // Nesquik → Suíça (SEDE Nestlé, NÃO locale)
  assert.equal(paisDoEan('4068706499340').iso, 'DE'); // anchovas → Alemanha (armadilha: produto ibérico)
  assert.equal(paisDoEan('3017620422003').iso, 'FR'); // Nutella FR
  assert.equal(paisDoEan('0000000000000').iso, 'US');
  assert.equal(paisDoEan('123'), null);                // inválido (não-13) → null
});

test('código interno de loja (prefixo 2xx) não é país', () => {
  assert.equal(eanInterno('2300001000005'), true);
  assert.equal(paisDoEan('2300001000005').interno, true);
  assert.equal(paisDoEan('2300001000005').iso, null);
  assert.equal(eanInterno('5601151979969'), false);
});

test('checksum EAN-13 (módulo ean.js)', () => {
  assert.equal(eanValido('5601151979969'), true);  // Compal real
  assert.equal(eanValido('5601151979960'), false); // último dígito errado
  assert.equal(eanValido('123'), false);
});

test('analiseEan (passo 0 do fusor)', () => {
  const a = analiseEan('7896089011357');
  assert.equal(a.valido, true);
  assert.equal(a.pais.iso, 'BR');
  assert.equal(a.interno, false);
  assert.equal(a.empresa, null); // empresa vem do ean_empresa (BD), passada à parte
});

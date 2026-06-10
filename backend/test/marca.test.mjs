import test from 'node:test';
import assert from 'node:assert/strict';
import { detetarMarca } from '../src/normaliza/marca.js';

const gaz = new Map([
  ['danone', 'Danone'],
  ['serramel', 'Serramel'],
  ['la molisana', 'La Molisana'],
  ['pato', 'Pato'],         // marca real no catálogo MAS palavra de produto → bloqueada
  ['grainha', 'Grainha'],   // idem
  ['gullon', 'Gullon'],
]);

test('marcador de cadeia ganha (CNT/PD/ARO)', () => {
  assert.deepEqual(detetarMarca('BOL DIGESTIVE AVEIA CNT 425GR', gaz), { marca: 'Continente', origem: 'marcador' });
  assert.deepEqual(detetarMarca('QJ GOUDA FAT PD 200G', gaz), { marca: 'Pingo Doce', origem: 'marcador' });
  assert.deepEqual(detetarMarca('ARO QJ MOZZARELA FATIAS 1 KG', gaz), { marca: 'Aro', origem: 'marcador' });
});

test('gazetteer: marca impressa reconhecida', () => {
  assert.deepEqual(detetarMarca('IOG OIKOS DANONE NATURAL 900G', gaz), { marca: 'Danone', origem: 'gazetteer' });
  assert.deepEqual(detetarMarca('MEL SERRAMEL 500GRS', gaz), { marca: 'Serramel', origem: 'gazetteer' });
});

test('gazetteer multi-token: todos os tokens têm de aparecer', () => {
  assert.deepEqual(detetarMarca('PASSATA AL BASILICO LA MOLISANA', gaz), { marca: 'La Molisana', origem: 'gazetteer' });
  assert.equal(detetarMarca('PASSATA MOLISANA', gaz), null); // falta o "la" → não arrisca
});

test('palavras de produto NUNCA são evidência de marca (blocklist)', () => {
  assert.equal(detetarMarca('EMPADA DE PATO', gaz), null);
  assert.equal(detetarMarca('UVA BRANCA SEM GRAINHA 500G', gaz), null);
});

test('sem marca → null (fica para o LLM ou "desconhecida")', () => {
  assert.equal(detetarMarca('BANANA', gaz), null);
});

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

// --- posição plausível da marca (app Lista 2026-10-16: descritores no campo "marca" dos catálogos) ---
const gazLixo = new Map([
  ['carne bovina', 'Carne Bovina'], ['forma', 'Forma'], ['rolo', 'Rolo'], ['de laranja', 'De Laranja'],
  ['cha cha', 'Chá Chá'], ['pescada', 'Pescada'], ['queijo minas frescal', 'Queijo Minas Frescal'],
  ['cherry', 'Cherry'], ['holandes', 'Holandês'], ['oikos', 'Oikos'], ['pingo doce', 'Pingo Doce'], ['la molisana', 'La Molisana'],
]);

test('marca com palavras ESPALHADAS no nome não conta (carne picada bovina)', () => {
  assert.equal(detetarMarca('carne picada bovina', gazLixo), null);
});
test('marca repetida que não está repetida no nome não conta (chá → "Chá Chá")', () => {
  assert.equal(detetarMarca('Chá', gazLixo), null);
});
test('marca = nome inteiro não é marca (Pescada, Queijo Minas Frescal)', () => {
  assert.equal(detetarMarca('Pescada', gazLixo), null);
  assert.equal(detetarMarca('Queijo Minas Frescal', gazLixo), null);
});
test('marca colada a uma ligação é complemento do produto (pão DE forma, rolo DE cozinha, sumo DE laranja)', () => {
  assert.equal(detetarMarca('pão de forma', gazLixo), null);
  assert.equal(detetarMarca('Pão de Forma Integral', gazLixo), null);
  assert.equal(detetarMarca('rolo de cozinha', gazLixo), null);
  assert.equal(detetarMarca('sumo de laranja', gazLixo), null);
});
test('variedade/origem não é marca (tomate cherry, gouda holandês)', () => {
  assert.equal(detetarMarca('tomate cherry', gazLixo), null);
  assert.equal(detetarMarca('Queijo Gouda Holandês', gazLixo), null);
});
test('marcas verdadeiras continuam reconhecidas', () => {
  assert.equal(detetarMarca('Iogurte Natural Oikos', gazLixo)?.marca, 'Oikos');
  assert.equal(detetarMarca('IOG GREGO OIKOS 4X115G', gazLixo)?.marca, 'Oikos');
  assert.equal(detetarMarca('Azeitonas Pingo Doce', gazLixo)?.marca, 'Pingo Doce');
  assert.equal(detetarMarca('PASSATA AL BASILICO LA MOLISANA', gazLixo)?.marca, 'La Molisana');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { juntarSugestoes } from '../src/sugestoesCasa.js';

test('o que a casa já escreveu vem primeiro, depois o catálogo, sem repetidos', () => {
  const casa = [{ nome: 'Carne picada bovina', dias: 3 }, { nome: 'Carne', dias: 2 }];
  const cat = [{ generico: true, nome: 'Carne' }, { generico: true, nome: 'Carne Picada' }, { generico: false, nome: 'Carne Picada de Porco', marca: 'X' }];
  const r = juntarSugestoes(casa, cat);
  assert.deepEqual(r.map((x) => x.nome), ['Carne picada bovina', 'Carne', 'Carne Picada', 'Carne Picada de Porco']);
  assert.equal(r[0].casa, true);
  assert.equal(r[0].vezes, 3);
});
test('plural/singular contam como o mesmo nome (chave da lista)', () => {
  const r = juntarSugestoes([{ nome: 'Ovos', dias: 10 }], [{ generico: true, nome: 'Ovo' }, { generico: true, nome: 'Ovos frescos' }]);
  assert.deepEqual(r.map((x) => x.nome), ['Ovos', 'Ovos frescos']);
});
test('limites: no máximo 4 da casa e 8 no total', () => {
  const casa = Array.from({ length: 6 }, (_, i) => ({ nome: `Casa ${i}`, dias: 1 }));
  const cat = Array.from({ length: 10 }, (_, i) => ({ nome: `Cat ${i}` }));
  const r = juntarSugestoes(casa, cat);
  assert.equal(r.length, 8);
  assert.equal(r.filter((x) => x.casa).length, 4);
});

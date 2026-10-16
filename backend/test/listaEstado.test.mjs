// Estado local (otimista + fila offline) da app "Lista" — frontend/src/lista/estado.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enfileirar, aplicar, novaMedida } from '../../frontend/src/lista/estado.js';

test('aplicar add: item novo entra com grupo pelo nome e marca pendente', () => {
  const r = aplicar([], { op: 'add', tmp: 'tmp1', nome: 'Leite meio gordo', quantidade: 2 });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'tmp1');
  assert.equal(r[0].quantidade, 2);
  assert.equal(r[0].grupo, 'lacticinios');
  assert.equal(r[0].pendente, true);
});

test('aplicar add: o mesmo nome consolida (soma) e volta a ativo — como o servidor', () => {
  const ini = [{ id: 7, nome: 'Leite', quantidade: 1, estado: 'carrinho', marcado_por: 'Sue' }];
  const r = aplicar(ini, { op: 'add', tmp: 'tmp2', nome: 'leite ', quantidade: 2 });
  assert.equal(r.length, 1);
  assert.equal(r[0].quantidade, 3);
  assert.equal(r[0].estado, 'ativo');
  assert.equal(r[0].marcado_por, null);
});

test('aplicar inc: limites 1..99', () => {
  const ini = [{ id: 1, nome: 'Ovos', quantidade: 1 }];
  assert.equal(aplicar(ini, { op: 'inc', id: 1, inc: -1 })[0].quantidade, 1);
  assert.equal(aplicar(ini, { op: 'inc', id: 1, inc: 200 })[0].quantidade, 99);
});

test('aplicar marcar/desmarcar e remover', () => {
  const ini = [{ id: 1, nome: 'Pão', estado: 'ativo' }, { id: 2, nome: 'Sal', estado: 'ativo' }];
  const m = aplicar(ini, { op: 'marcar', id: 1, marcado: true }, 'Gustavo');
  assert.equal(m[0].estado, 'carrinho');
  assert.equal(m[0].marcado_por, 'Gustavo');
  assert.equal(aplicar(m, { op: 'marcar', id: '1', marcado: false })[0].estado, 'ativo');
  assert.deepEqual(aplicar(ini, { op: 'remover', id: 2 }).map((x) => x.id), [1]);
});

test('enfileirar medida: só o último peso conta', () => {
  let f = enfileirar([], { op: 'medida', id: 3, qtd_medida: 0.5, unidade: 'kg' });
  f = enfileirar(f, { op: 'medida', id: 3, qtd_medida: 0.75, unidade: 'kg' });
  assert.equal(f.length, 1);
  assert.equal(f[0].qtd_medida, 0.75);
});

test('enfileirar remover: limpa as medidas pendentes do alvo', () => {
  let f = enfileirar([], { op: 'medida', id: 3, qtd_medida: 0.5, unidade: 'kg' });
  f = enfileirar(f, { op: 'remover', id: 3 });
  assert.deepEqual(f, [{ op: 'remover', id: 3 }]);
});

test('enfileirar: add offline seguido de remover não manda nada ao servidor', () => {
  let f = enfileirar([], { op: 'add', tmp: 'tmp9', nome: 'Café' });
  f = enfileirar(f, { op: 'remover', id: 'tmp9' });
  assert.deepEqual(f, []);
});

test('novaMedida: passos de 50 g abaixo de 1 kg, 250 g acima, nunca abaixo de 50 g', () => {
  assert.equal(novaMedida(0.5, 1), 0.55);
  assert.equal(novaMedida(1, 1), 1.25);
  assert.equal(novaMedida(1, -1), 0.95);
  assert.equal(novaMedida(1.25, -1), 1);
  assert.equal(novaMedida(0.05, -1), 0.05);
});

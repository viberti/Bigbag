// Testa a lógica PURA do outbox offline da lista (vive no frontend, mas é JS
// puro — importável aqui). Corre com: node --test test/listaOutbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { coalescar, resolverId } from '../../frontend/src/listaOutbox.js';

// helper: aplica uma sequência de ops a uma fila vazia
const fila = (...ops) => ops.reduce((f, op) => coalescar(f, op), []);

test('add acumula; cada um é distinto', () => {
  const f = fila({ op: 'add', tmp: 'tmp1', nome: 'Leite' }, { op: 'add', tmp: 'tmp2', nome: 'Pão' });
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.nome), ['Leite', 'Pão']);
});

test('inc no mesmo alvo SOMA num só (5 toques no + = inc 5)', () => {
  const f = fila(
    { op: 'inc', id: 7, inc: 1 }, { op: 'inc', id: 7, inc: 1 },
    { op: 'inc', id: 7, inc: 1 }, { op: 'inc', id: 7, inc: 1 }, { op: 'inc', id: 7, inc: 1 });
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], { op: 'inc', id: 7, inc: 5 });
});

test('inc que se anula (+1 -1) desaparece da fila', () => {
  const f = fila({ op: 'inc', id: 7, inc: 1 }, { op: 'inc', id: 7, inc: -1 });
  assert.equal(f.length, 0);
});

test('inc de alvos diferentes não se misturam', () => {
  const f = fila({ op: 'inc', id: 7, inc: 2 }, { op: 'inc', id: 8, inc: 3 });
  assert.equal(f.length, 2);
});

test('qtd é absoluto: o último manda e limpa incs anteriores do alvo', () => {
  const f = fila({ op: 'inc', id: 7, inc: 5 }, { op: 'qtd', id: 7, quantidade: 2 }, { op: 'qtd', id: 7, quantidade: 9 });
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], { op: 'qtd', id: 7, quantidade: 9 });
});

test('marcar/desmarcar colapsa no último estado', () => {
  const f = fila({ op: 'marcar', id: 7, marcado: true }, { op: 'marcar', id: 7, marcado: false });
  assert.equal(f.length, 1);
  assert.equal(f[0].marcado, false);
});

test('nome (concretizar variante) — só o último', () => {
  const f = fila({ op: 'nome', id: 7, nome: 'Iogurte' }, { op: 'nome', id: 7, nome: 'Iogurte Grego Natural' });
  assert.equal(f.length, 1);
  assert.equal(f[0].nome, 'Iogurte Grego Natural');
});

test('remover (item REAL) anula as pendências do alvo e fica só o remover', () => {
  const f = fila(
    { op: 'inc', id: 7, inc: 3 },
    { op: 'marcar', id: 7, marcado: true },
    { op: 'remover', id: 7 });
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], { op: 'remover', id: 7 });
});

test('remover de item criado OFFLINE (tmp) apaga o add e NÃO envia remover (nunca existiu no servidor)', () => {
  const f = fila(
    { op: 'add', tmp: 'tmp9', nome: 'Sal' },
    { op: 'inc', id: 'tmp9', inc: 2 },
    { op: 'remover', id: 'tmp9' });
  assert.equal(f.length, 0); // nada a sincronizar
});

test('remover de um alvo não toca nas ops de OUTROS alvos', () => {
  const f = fila(
    { op: 'add', tmp: 'tmp1', nome: 'Leite' },
    { op: 'inc', id: 8, inc: 1 },
    { op: 'remover', id: 8 });
  // o add do Leite sobrevive; o inc do 8 foi anulado e fica o remover do 8 (real)
  assert.equal(f.length, 2);
  assert.ok(f.some((x) => x.op === 'add' && x.nome === 'Leite'));
  assert.ok(f.some((x) => x.op === 'remover' && String(x.id) === '8'));
  assert.ok(!f.some((x) => x.op === 'inc')); // o inc do 8 desapareceu
});

test('fluxo tmp: add + inc + marcar no MESMO item offline, remap resolve no despacho', () => {
  // como ficaria a fila ao adicionar "Leite" offline, somar +1 e riscar
  const f = fila(
    { op: 'add', tmp: 'tmp1', nome: 'Leite', quantidade: 1 },
    { op: 'inc', id: 'tmp1', inc: 1 },
    { op: 'marcar', id: 'tmp1', marcado: true });
  assert.equal(f.length, 3);
  // ao despachar, o add devolve id real 42 → remap
  const remap = { tmp1: 42 };
  assert.equal(resolverId('tmp1', remap), 42); // inc e marcar vão para o id 42
  assert.equal(resolverId(7, remap), 7);        // ids reais não mudam
});

test('coalescar não muta a fila recebida', () => {
  const f0 = [{ op: 'inc', id: 7, inc: 1 }];
  const f1 = coalescar(f0, { op: 'inc', id: 7, inc: 1 });
  assert.equal(f0[0].inc, 1);  // original intacto
  assert.equal(f1[0].inc, 2);
});

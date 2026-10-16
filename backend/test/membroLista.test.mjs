import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membroDoUtilizador as m } from '../src/routes/lista.js';

const perfis = [{ nome: 'Sue' }, { nome: 'Gustavo' }];
test('JWT com nome → o membro com esse nome', () => {
  assert.equal(m({ id: 'gviberti3@gmail.com', email: 'gviberti3@gmail.com', nome: 'Gustavo' }, perfis), 'Gustavo');
});
test('sem nome: início do email casa o membro (suerocha@ → Sue)', () => {
  assert.equal(m({ id: 'suerocha@gmail.com', email: 'suerocha@gmail.com', nome: null }, perfis), 'Sue');
});
test('Basic de teste: o utilizador é o nome do membro (minúsculas)', () => {
  assert.equal(m({ id: 'gustavo' }, perfis), 'Gustavo');
});
test('sem correspondência → null (cai no membro ativo)', () => {
  assert.equal(m({ id: 'gviberti3@gmail.com', email: 'gviberti3@gmail.com', nome: null }, perfis), null);
  assert.equal(m({ id: 'teste-lista@bigbag.test' }, perfis), null);
});

import { membroEscolhido as esc } from '../src/routes/lista.js';
test('X-Membro: escolhido no ecrã "Quem está usando?" vale se for membro da casa', () => {
  assert.equal(esc('Gustavo', perfis), 'Gustavo');
  assert.equal(esc('sue', perfis), 'Sue');
  assert.equal(esc(encodeURIComponent('Sue'), perfis), 'Sue');
});
test('X-Membro: nome que não é membro é ignorado (não grava nomes arbitrários)', () => {
  assert.equal(esc('Intruso', perfis), null);
  assert.equal(esc('', perfis), null);
  assert.equal(esc(undefined, perfis), null);
});

// E2E da LISTA SEPARADA da app "Lista" (migr. 099): contra o backend VIVO (127.0.0.1:4200),
// com um JWT do próprio projeto para uma identidade de teste (nunca sai do servidor).
// Garante: (1) a app Lista vê só a sua lista; (2) o BigBag (sem header) não a vê nem a
// consegue alterar; (3) a lista do BigBag fica INTACTA. Higiene: apaga só os ids que criou.
// Correr no servidor: sudo -u dev node --env-file=.env --test test/listaSimples.bd.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { assinarToken } from '../src/auth.js';

const BASE = process.env.TESTE_BASE || 'http://127.0.0.1:4200';
const pool = getPool();
const criados = [];
const token = await assinarToken({ email: 'teste-lista@bigbag.test', nome: 'Teste Lista' });

async function api(caminho, { metodo = 'GET', corpo, lista = 'simples' } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (lista) headers['X-Lista'] = lista;
  if (corpo) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, dados: await r.json().catch(() => null) };
}
const fotoBigbag = async () => (await pool.query(
  "SELECT id, nome, quantidade, estado FROM lista_item WHERE lista = 'bigbag' AND estado IN ('ativo','carrinho') ORDER BY id"))[0];
const estadoDe = async (id) => (await pool.query('SELECT lista, estado, quantidade FROM lista_item WHERE id = ?', [id]))[0][0];

const antes = await fotoBigbag();

after(async () => {
  if (criados.length) await pool.query('DELETE FROM lista_item WHERE id IN (?)', [criados]);
  const depois = await fotoBigbag();
  assert.deepEqual(depois, antes, 'a lista do BigBag NÃO pode mudar com o teste');
  await closePool();
});

test('adicionar na app Lista grava na lista "simples"', async () => {
  const r = await api('/api/lista', { metodo: 'POST', corpo: { nome: 'ZZ Teste Lista Arroz', quantidade: 2 } });
  assert.equal(r.status, 200);
  criados.push(r.dados.id);
  const e = await estadoDe(r.dados.id);
  assert.equal(e.lista, 'simples');
  assert.equal(e.quantidade, 2);
});

test('a app Lista vê o item; o BigBag (sem header) não', async () => {
  const id = criados[0];
  const lst = await api('/api/lista');
  assert.equal(lst.status, 200);
  assert.ok(lst.dados.itens.some((x) => x.id === id), 'app Lista deve ver o item');
  assert.ok(lst.dados.itens[0].grupo !== undefined, 'itens vêm enriquecidos pelo resolver (grupo/preço)');
  const big = await api('/api/lista', { lista: null });
  assert.ok(!big.dados.itens.some((x) => x.id === id), 'BigBag não pode ver o item da outra lista');
});

test('o mesmo nome consolida dentro da lista (soma), sem criar outro', async () => {
  const r = await api('/api/lista', { metodo: 'POST', corpo: { nome: 'zz teste lista arroz', quantidade: 1 } });
  assert.equal(r.dados.id, criados[0]);
  assert.equal(r.dados.consolidado, true);
  assert.equal((await estadoDe(criados[0])).quantidade, 3);
});

test('o BigBag não consegue riscar nem apagar itens da outra lista', async () => {
  const id = criados[0];
  await api(`/api/lista/${id}`, { metodo: 'PATCH', corpo: { marcado: true }, lista: null });
  assert.equal((await estadoDe(id)).estado, 'ativo');
  await api(`/api/lista/${id}`, { metodo: 'DELETE', lista: null });
  assert.equal((await estadoDe(id)).estado, 'ativo');
});

test('riscar, incrementar e apagar na própria lista', async () => {
  const id = criados[0];
  await api(`/api/lista/${id}`, { metodo: 'PATCH', corpo: { inc: 1 } });
  assert.equal((await estadoDe(id)).quantidade, 4);
  await api(`/api/lista/${id}`, { metodo: 'PATCH', corpo: { marcado: true } });
  assert.equal((await estadoDe(id)).estado, 'carrinho');
  await api(`/api/lista/${id}`, { metodo: 'DELETE' });
  assert.equal((await estadoDe(id)).estado, 'removido');
});

test('lote, esvaziar e desfazer tocam só na lista "simples"', async () => {
  const lote = await api('/api/lista/lote', { metodo: 'POST', corpo: { produtos: [{ nome: 'ZZ Teste Lista Café', quantidade: 1 }, { nome: 'ZZ Teste Lista Sal', quantidade: 2 }] } });
  assert.equal(lote.status, 200);
  for (const a of lote.dados.adicionados) criados.push(a.id);
  assert.ok(lote.dados.itens.every((x) => x.id), 'devolve a lista completa');
  const limpo = await api('/api/lista/limpar', { metodo: 'POST' });
  const ids = limpo.dados.limpos.map((x) => x.id);
  for (const a of lote.dados.adicionados) assert.ok(ids.includes(a.id));
  const [[fora]] = await pool.query("SELECT COUNT(*) n FROM lista_item WHERE id IN (?) AND lista <> 'simples'", [ids]);
  assert.equal(Number(fora.n), 0, 'esvaziar não pode tocar noutra lista');
  const rest = await api('/api/lista/restaurar', { metodo: 'POST', corpo: { itens: limpo.dados.limpos } });
  assert.equal(rest.dados.restaurados, ids.length);
});

test('sugestões respondem na lista "simples"', async () => {
  const r = await api('/api/lista/sugestoes');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.dados.sugestoes));
});

test('concluir: riscados passam a COMPRADO (não removido) só na própria lista', async (t) => {
  // o concluir atua em TODOS os riscados da lista: se o utilizador tem riscados reais, não arrisca
  const [[r0]] = await pool.query("SELECT COUNT(*) n FROM lista_item WHERE lista = 'simples' AND estado = 'carrinho'");
  if (Number(r0.n) > 0) { t.skip('há riscados reais na lista simples — não toca'); return; }
  const a = await api('/api/lista', { metodo: 'POST', corpo: { nome: 'ZZ Teste Lista Concluir' } });
  criados.push(a.dados.id);
  await api(`/api/lista/${a.dados.id}`, { metodo: 'PATCH', corpo: { marcado: true } });
  const r = await api('/api/lista/concluir', { metodo: 'POST' });
  assert.ok(r.dados.comprados.includes(a.dados.id));
  assert.equal((await estadoDe(a.dados.id)).estado, 'comprado');
});

test('autocomplete sugere primeiro o que a casa já escreveu na lista', async () => {
  const r = await api('/api/produto/autocomplete?q=zz%20teste%20lista%20conc&modo=lista', { lista: null });
  assert.equal(r.status, 200);
  assert.equal(r.dados.sugestoes[0]?.nome, 'ZZ Teste Lista Concluir');
  assert.equal(r.dados.sugestoes[0]?.casa, true);
});

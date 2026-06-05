// Teste de integração das 4 funções de consulta contra MySQL real (app_bigbag).
// Tudo dentro de UMA transação com ROLLBACK no fim → não persiste nada.
// Prova: a lógica de dados (preço por base, filtros clearance/non_product,
// ordenação, somas) e, de caminho, que o GRANT do user `bigbag` chega para DML.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { executarTool } from '../src/tools.js';

let conn;

before(async () => {
  conn = await getPool().getConnection();
  await conn.beginTransaction();

  // ── lojas ──
  const [ct] = await conn.query(
    "INSERT INTO loja (cadeia, nome, nif) VALUES ('Continente','Continente Braga','TST-CNT')",
  );
  const [pd] = await conn.query(
    "INSERT INTO loja (cadeia, nome, nif) VALUES ('Pingo Doce','Pingo Doce Braga','TST-PD')",
  );
  const lojaCnt = ct.insertId;
  const lojaPd = pd.insertId;

  // ── skus ──
  const [mant] = await conn.query(
    "INSERT INTO sku_normalizado (nome_canonico, marca, categoria, unidade_base, formato_valor) VALUES ('Manteiga Mimosa','Mimosa','Laticínios','un',0.25)",
  );
  const [cafe] = await conn.query(
    "INSERT INTO sku_normalizado (nome_canonico, marca, categoria, unidade_base, formato_valor) VALUES ('Café Moído X','Delta','Cafés','kg',0.25)",
  );
  const skuMant = mant.insertId;
  const skuCafe = cafe.insertId;

  // ── faturas ──
  const novaFatura = async (lojaId, data, total) => {
    const [r] = await conn.query(
      "INSERT INTO fatura (loja_id, data_compra, total_impresso, metodo_extracao) VALUES (?,?,?,'vlm')",
      [lojaId, data, total],
    );
    return r.insertId;
  };
  const f1 = await novaFatura(lojaCnt, '2026-05-01 10:00:00', 5.89); // Continente, mais antiga
  const f2 = await novaFatura(lojaPd, '2026-05-28 18:30:00', 5.49); // Pingo Doce, mais recente
  const f3 = await novaFatura(lojaCnt, '2026-05-15 11:00:00', 1.0); // Continente, clearance

  // ── itens ──
  const novoItem = (faturaId, skuId, desc, precoLiq, precoBase, opts = {}) =>
    conn.query(
      `INSERT INTO item (fatura_id, sku_id, descricao_original, quantidade, preco_liquido, preco_por_base, is_clearance, is_non_product)
       VALUES (?,?,?,1,?,?,?,?)`,
      [faturaId, skuId, desc, precoLiq, precoBase, opts.clearance ? 1 : 0, opts.nonProduct ? 1 : 0],
    );

  // F1 Continente: manteiga 2.39, café 3.50
  await novoItem(f1, skuMant, 'MANT MIMOSA 250G', 2.39, 2.39);
  await novoItem(f1, skuCafe, 'CAFE DELTA 250G', 3.5, 14.0);
  // F2 Pingo Doce: manteiga 2.19 (mais recente e mais barata), café 3.20, saco 0.10 (não-produto)
  await novoItem(f2, skuMant, 'MANTEIGA MIMOSA', 2.19, 2.19);
  await novoItem(f2, skuCafe, 'CAFE DELTA', 3.2, 12.8);
  await novoItem(f2, null, 'SACO REUTILIZAVEL', 0.1, null, { nonProduct: true });
  // F3 Continente: manteiga em fim de validade 1.00 (deve ser EXCLUÍDA de compare/historico)
  await novoItem(f3, skuMant, 'MANT MIMOSA -50%', 1.0, 1.0, { clearance: true });
});

after(async () => {
  if (conn) {
    await conn.rollback();
    conn.release();
  }
  await closePool();
});

test('buscar_ultima_compra: devolve a compra mais recente (Pingo Doce, 2,19)', async () => {
  const r = await executarTool(conn, 'buscar_ultima_compra', { produto: 'manteiga' });
  assert.ok(r, 'esperava um resultado');
  assert.equal(r.loja, 'Pingo Doce Braga');
  assert.equal(r.cadeia, 'Pingo Doce');
  assert.equal(Number(r.preco), 2.19);
  assert.equal(r.data, '2026-05-28');
});

test('comparar_precos_por_loja: ordena por preço/base e exclui clearance', async () => {
  const r = await executarTool(conn, 'comparar_precos_por_loja', { produto: 'manteiga' });
  assert.equal(r.length, 2, 'esperava 2 lojas');
  assert.equal(r[0].cadeia, 'Pingo Doce'); // mais barato primeiro
  assert.equal(Number(r[0].preco_por_base), 2.19);
  assert.equal(r[1].cadeia, 'Continente');
  // 2,39 (compra normal) e NÃO 1,00 (clearance, excluída)
  assert.equal(Number(r[1].preco_por_base), 2.39);
});

test('historico_preco: cronológico e sem clearance/não-produto', async () => {
  const r = await executarTool(conn, 'historico_preco', { produto: 'manteiga' });
  assert.equal(r.length, 2, 'clearance deve ser excluída → 2 registos');
  assert.equal(r[0].data, '2026-05-01'); // ordem ascendente
  assert.equal(r[1].data, '2026-05-28');
});

test('historico_preco: respeita o filtro `desde`', async () => {
  const r = await executarTool(conn, 'historico_preco', { produto: 'manteiga', desde: '2026-05-10' });
  assert.equal(r.length, 1);
  assert.equal(r[0].data, '2026-05-28');
});

test('total_gasto: por produto (café = 3,50 + 3,20 = 6,70)', async () => {
  const r = await executarTool(conn, 'total_gasto', { alvo: 'café', periodo_inicio: '2026-05-01' });
  assert.equal(Number(r.total), 6.7);
  assert.equal(Number(r.n_itens), 2);
});

test('total_gasto: por categoria (Laticínios inclui clearance, exclui não-produto)', async () => {
  const r = await executarTool(conn, 'total_gasto', { alvo: 'Laticínios', periodo_inicio: '2026-05-01' });
  // manteiga: 2,39 + 2,19 + 1,00 (clearance conta como gasto real) = 5,58
  assert.equal(Number(r.total), 5.58);
  assert.equal(Number(r.n_itens), 3);
});

test("total_gasto: 'tudo' soma gasto em produtos, exclui saco (não-produto)", async () => {
  const r = await executarTool(conn, 'total_gasto', { alvo: 'tudo', periodo_inicio: '2026-05-01' });
  // 2,39 + 3,50 + 2,19 + 3,20 + 1,00 = 12,28  (saco 0,10 fora)
  assert.equal(Number(r.total), 12.28);
  assert.equal(Number(r.n_itens), 5);
});

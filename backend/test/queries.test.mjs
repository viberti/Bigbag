// Teste de integração das 4 funções de consulta contra MySQL real (app_bigbag).
// Tudo numa transação com ROLLBACK → não persiste nada.
//
// ISOLAMENTO de dados reais: como a BD já tem faturas verdadeiras (e a
// transação vê dados committed), o seed usa NOMES-SENTINELA (token ZZTEST) e
// DATAS em 2099. Assim as queries por token só apanham o seed, e total_gasto
// num período de 2099 não soma faturas reais (de 2026).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { executarTool } from '../src/tools.js';

const T = 'ZZTEST'; // sentinela improvável em dados reais
const MANT = `Manteiga ${T}`;
const CAFE = `Café ${T}`;
const CAT = `${T}_Laticinios`;

let conn;

before(async () => {
  conn = await getPool().getConnection();
  await conn.beginTransaction();

  const [ct] = await conn.query(
    "INSERT INTO loja (cadeia, nome, nif) VALUES ('Continente',?,?)",
    [`Continente ${T}`, `${T}-CNT`],
  );
  const [pd] = await conn.query(
    "INSERT INTO loja (cadeia, nome, nif) VALUES ('Pingo Doce',?,?)",
    [`Pingo Doce ${T}`, `${T}-PD`],
  );
  const lojaCnt = ct.insertId;
  const lojaPd = pd.insertId;

  const [mant] = await conn.query(
    'INSERT INTO sku_normalizado (nome_canonico, marca, categoria, unidade_base, formato_valor) VALUES (?,?,?,?,?)',
    [MANT, 'Mimosa', CAT, 'un', 0.25],
  );
  const [cafe] = await conn.query(
    'INSERT INTO sku_normalizado (nome_canonico, marca, categoria, unidade_base, formato_valor) VALUES (?,?,?,?,?)',
    [CAFE, 'Delta', `${T}_Cafes`, 'kg', 0.25],
  );
  const skuMant = mant.insertId;
  const skuCafe = cafe.insertId;

  const novaFatura = async (lojaId, data, total) => {
    const [r] = await conn.query(
      "INSERT INTO fatura (loja_id, data_compra, total_impresso, metodo_extracao) VALUES (?,?,?,'vlm')",
      [lojaId, data, total],
    );
    return r.insertId;
  };
  const f1 = await novaFatura(lojaCnt, '2099-05-01 10:00:00', 5.89);
  const f2 = await novaFatura(lojaPd, '2099-05-28 18:30:00', 5.49);
  const f3 = await novaFatura(lojaCnt, '2099-05-15 11:00:00', 1.0);

  const novoItem = (faturaId, skuId, desc, precoLiq, precoBase, opts = {}) =>
    conn.query(
      `INSERT INTO item (fatura_id, sku_id, descricao_original, quantidade, preco_liquido, preco_por_base, is_clearance, is_non_product)
       VALUES (?,?,?,1,?,?,?,?)`,
      [faturaId, skuId, desc, precoLiq, precoBase, opts.clearance ? 1 : 0, opts.nonProduct ? 1 : 0],
    );

  await novoItem(f1, skuMant, `MANT ${T} 250G`, 2.39, 2.39);
  await novoItem(f1, skuCafe, `CAFE ${T} 250G`, 3.5, 14.0);
  await novoItem(f2, skuMant, `MANTEIGA ${T}`, 2.19, 2.19);
  await novoItem(f2, skuCafe, `CAFE ${T}`, 3.2, 12.8);
  await novoItem(f2, null, `SACO ${T}`, 0.1, null, { nonProduct: true });
  await novoItem(f3, skuMant, `MANT ${T} -50%`, 1.0, 1.0, { clearance: true });
});

after(async () => {
  if (conn) {
    await conn.rollback();
    conn.release();
  }
  await closePool();
});

test('buscar_ultima_compra: devolve a compra mais recente (Pingo Doce, 2,19)', async () => {
  const r = await executarTool(conn, 'buscar_ultima_compra', { produto: MANT });
  assert.ok(r, 'esperava um resultado');
  assert.equal(r.cadeia, 'Pingo Doce');
  assert.equal(Number(r.preco), 2.19);
  assert.equal(r.data, '2099-05-28');
});

test('comparar_precos_por_loja: ordena por preço/base e exclui clearance', async () => {
  const r = await executarTool(conn, 'comparar_precos_por_loja', { produto: MANT });
  assert.equal(r.length, 2, 'esperava 2 lojas');
  assert.equal(r[0].cadeia, 'Pingo Doce');
  assert.equal(Number(r[0].preco_por_base), 2.19);
  assert.equal(r[1].cadeia, 'Continente');
  assert.equal(Number(r[1].preco_por_base), 2.39); // 2,39 normal, NÃO 1,00 (clearance)
});

test('historico_preco: cronológico e sem clearance/não-produto', async () => {
  const r = await executarTool(conn, 'historico_preco', { produto: MANT });
  assert.equal(r.length, 2);
  assert.equal(r[0].data, '2099-05-01');
  assert.equal(r[1].data, '2099-05-28');
});

test('historico_preco: respeita o filtro `desde`', async () => {
  const r = await executarTool(conn, 'historico_preco', { produto: MANT, desde: '2099-05-10' });
  assert.equal(r.length, 1);
  assert.equal(r[0].data, '2099-05-28');
});

test('total_gasto: por produto (café = 3,50 + 3,20 = 6,70)', async () => {
  const r = await executarTool(conn, 'total_gasto', { alvo: CAFE, periodo_inicio: '2099-01-01', periodo_fim: '2099-12-31' });
  assert.equal(Number(r.total), 6.7);
  assert.equal(Number(r.n_itens), 2);
});

test('total_gasto: por categoria (inclui clearance, exclui não-produto)', async () => {
  const r = await executarTool(conn, 'total_gasto', { alvo: CAT, periodo_inicio: '2099-01-01', periodo_fim: '2099-12-31' });
  assert.equal(Number(r.total), 5.58); // 2,39 + 2,19 + 1,00
  assert.equal(Number(r.n_itens), 3);
});

test('listar_compras: enumera os itens do período (exclui não-produto)', async () => {
  const r = await executarTool(conn, 'listar_compras', { periodo_inicio: '2099-01-01', periodo_fim: '2099-12-31' });
  assert.equal(r.length, 5); // manteiga ×3 (inc. clearance) + café ×2; saco fora
  assert.ok(r.every((x) => x.produto && x.preco_liquido != null && x.data));
});

test('listar_compras: filtra por alvo (só café = 2 itens)', async () => {
  const r = await executarTool(conn, 'listar_compras', {
    periodo_inicio: '2099-01-01',
    periodo_fim: '2099-12-31',
    alvo: CAFE,
  });
  assert.equal(r.length, 2);
});

test('listar_compras agrupar_por=produto: agrega por produto, sem loja/data', async () => {
  const r = await executarTool(conn, 'listar_compras', {
    periodo_inicio: '2099-01-01',
    periodo_fim: '2099-12-31',
    agrupar_por: 'produto',
  });
  assert.equal(r.length, 2); // Manteiga (3×) e Café (2×)
  const cafe = r.find((x) => x.produto === CAFE);
  assert.equal(Number(cafe.total), 6.7);
  assert.equal(Number(cafe.vezes), 2);
  assert.ok(!('loja' in r[0]) && !('data' in r[0]));
});

test('detalhes_fatura: por data devolve a fatura e os itens (preço impresso)', async () => {
  const r = await executarTool(conn, 'detalhes_fatura', { data: '2099-05-01' });
  assert.equal(r.encontrada, true);
  assert.equal(r.data, '2099-05-01');
  assert.equal(r.itens.length, 2); // manteiga + café da f1
  assert.ok(r.itens.every((i) => i.preco != null));
});

test('produto_mais_barato: traz o produto que casa, mais barato primeiro', async () => {
  const r = await executarTool(conn, 'produto_mais_barato', { alvo: MANT });
  assert.ok(r.length >= 1);
  assert.equal(r[0].produto, MANT);
  assert.equal(Number(r[0].preco_por_base), 2.19); // mais recente, sem clearance
});

test('total_gasto: filtra por loja (só Pingo Doce = 5,39)', async () => {
  const r = await executarTool(conn, 'total_gasto', {
    alvo: 'tudo',
    periodo_inicio: '2099-01-01',
    periodo_fim: '2099-12-31',
    loja: 'Pingo Doce',
  });
  assert.equal(Number(r.total), 5.39); // manteiga 2,19 + café 3,20 (saco fora)
  assert.equal(Number(r.n_itens), 2);
});

test("total_gasto: 'tudo' no período de 2099 (isolado de faturas reais)", async () => {
  const r = await executarTool(conn, 'total_gasto', { alvo: 'tudo', periodo_inicio: '2099-01-01', periodo_fim: '2099-12-31' });
  assert.equal(Number(r.total), 12.28); // 2,39+3,50+2,19+3,20+1,00 (saco fora)
  assert.equal(Number(r.n_itens), 5);
});

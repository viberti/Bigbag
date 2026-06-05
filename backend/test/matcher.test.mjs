// Integração do matcher de SKU: alias cache, criar vs. emparelhar, revisão.
// Stub do canonicalizar (sem LLM) → determinístico. Transação + ROLLBACK.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { resolverSku } from '../src/normaliza/matcher.js';

// marca-sentinela ZZTESTMARCA: os candidatos são filtrados por marca, logo
// nenhum SKU real (que tem outra marca) entra → teste isolado da BD partilhada.
const stub = (desc) => {
  if (/ilegivel/i.test(desc)) return { nome_canonico: '??', marca: 'ZZTESTMARCA', categoria: 'X', unidade_base: 'un', confianca: 0.2 };
  if (/mant/i.test(desc))
    return { nome_canonico: 'Manteiga com Sal', marca: 'ZZTESTMARCA', categoria: 'Laticínios', unidade_base: 'kg', confianca: 0.9 };
  return { nome_canonico: 'Outro', marca: 'ZZTESTMARCA', categoria: 'X', unidade_base: 'un', confianca: 0.9 };
};

let conn;
before(async () => {
  conn = await getPool().getConnection();
  await conn.beginTransaction();
});
after(async () => {
  if (conn) {
    await conn.rollback();
    conn.release();
  }
  await closePool();
});

test('descrição nova → cria SKU (via novo) e grava alias', async () => {
  const r = await resolverSku(conn, 'MANTEIGA C/ SAL CONTINENTE 250G', { canonicalizar: stub });
  assert.equal(r.via, 'novo');
  assert.ok(r.sku_id > 0);
});

test('mesma descrição → resolve por alias (cache), mesmo sku_id', async () => {
  const r1 = await resolverSku(conn, 'MANTEIGA C/ SAL CONTINENTE 250G', { canonicalizar: stub });
  const r2 = await resolverSku(conn, 'MANTEIGA C/ SAL CONTINENTE 250G', { canonicalizar: stub });
  assert.equal(r2.via, 'alias');
  assert.equal(r2.sku_id, r1.sku_id);
});

test('descrição diferente, mesmo produto → emparelha ao SKU existente (via match)', async () => {
  const r1 = await resolverSku(conn, 'MANTEIGA C/ SAL CONTINENTE 250G', { canonicalizar: stub });
  const r3 = await resolverSku(conn, 'MANT C/SAL CONTINENTE 250G', { canonicalizar: stub });
  assert.equal(r3.via, 'match');
  assert.equal(r3.sku_id, r1.sku_id); // mesmo nome+marca+formato → mesmo SKU
});

test('Camada 3: variante do mesmo produto agrupa por similaridade', async () => {
  const stubVar = (desc) =>
    /dop/i.test(desc)
      ? { nome_canonico: 'Parmigiano Reggiano DOP 24 Meses', marca: 'ZZTESTMARCA', categoria: 'Queijos', unidade_base: 'un', confianca: 0.9 }
      : { nome_canonico: 'Parmigiano Reggiano', marca: 'ZZTESTMARCA', categoria: 'Queijos', unidade_base: 'un', confianca: 0.9 };
  const r1 = await resolverSku(conn, 'PARMIGIANO REGGIANO ZZ', { canonicalizar: stubVar });
  const r2 = await resolverSku(conn, 'PARMIGIANO REGGIAND DOP 24M ZZ', { canonicalizar: stubVar });
  assert.equal(r1.via, 'novo');
  assert.equal(r2.via, 'match');
  assert.equal(r2.sku_id, r1.sku_id);
});

test('confiança baixa → não liga, fica para revisão', async () => {
  const r = await resolverSku(conn, 'PRODUTO ILEGIVEL XPTO', { canonicalizar: stub });
  assert.equal(r.via, 'revisao');
  assert.equal(r.sku_id, null);
});

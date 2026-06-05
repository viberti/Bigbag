// Orquestração da consulta por texto: o loop tool-use executa a ferramenta
// escolhida e devolve a resposta final. LLM = stub determinístico; a ferramenta
// corre de verdade contra dados semeados (transação + ROLLBACK).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { responderPergunta } from '../src/consulta.js';

const T = 'ZZTESTQ';
let conn;

before(async () => {
  conn = await getPool().getConnection();
  await conn.beginTransaction();
  const [l] = await conn.query("INSERT INTO loja (cadeia, nome, nif) VALUES ('Lidl', ?, ?)", [`Lidl ${T}`, `${T}-L`]);
  const [s] = await conn.query(
    "INSERT INTO sku_normalizado (nome_canonico, categoria, unidade_base) VALUES (?, 'Cafés', 'un')",
    [`Café ${T}`],
  );
  const [f] = await conn.query(
    "INSERT INTO fatura (loja_id, data_compra, total_impresso, metodo_extracao) VALUES (?, '2099-05-01 10:00:00', 6.70, 'vlm')",
    [l.insertId],
  );
  for (const p of [3.5, 3.2]) {
    await conn.query(
      'INSERT INTO item (fatura_id, sku_id, descricao_original, preco_liquido) VALUES (?,?,?,?)',
      [f.insertId, s.insertId, `CAFE ${T}`, p],
    );
  }
});

after(async () => {
  if (conn) {
    await conn.rollback();
    conn.release();
  }
  await closePool();
});

test('pergunta → tool use (total_gasto) → resposta final', async () => {
  let ronda = 0;
  // stub do LLM: 1ª ronda pede a ferramenta; 2ª formula a resposta.
  const chat = async ({ messages }) => {
    ronda++;
    if (ronda === 1) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: {
              name: 'total_gasto',
              arguments: JSON.stringify({ alvo: `Café ${T}`, periodo_inicio: '2099-01-01', periodo_fim: '2099-12-31' }),
            },
          },
        ],
      };
    }
    // a 2ª chamada deve já ter o resultado da ferramenta nas mensagens
    const toolMsg = messages.find((m) => m.role === 'tool');
    const r = JSON.parse(toolMsg.content);
    return { role: 'assistant', content: `Gastaste ${String(r.total).replace('.', ',')} €.` };
  };

  const out = await responderPergunta('quanto gastei em café?', { db: conn, chat, hoje: '2099-06-01' });
  assert.equal(out.chamadas.length, 1);
  assert.equal(out.chamadas[0].nome, 'total_gasto');
  assert.equal(Number(out.chamadas[0].resultado.total), 6.7);
  assert.match(out.resposta, /6,7/);
});

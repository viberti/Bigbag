// As 4 funções de consulta (Bloco 3). Cada uma recebe `db` (pool OU ligação
// de transação — ambos têm .query) e devolve JSON simples/achatado, pronto a
// servir ao LLM para ele formular a resposta em português.
//
// Princípios (do conceito / schema):
//  - Comparações e histórico usam SEMPRE `preco_por_base` (€/kg, €/L, €/un).
//  - Excluem `is_clearance` (fim de validade) e `is_non_product` (saco/taxa).
//  - A correspondência "produto em linguagem natural" → SKU é do BACKEND.
//
// SUPOSIÇÃO REGISTADA (v1, reversível): a correspondência produto→SKU é um
// match ingénuo por LIKE sobre nome_canonico/marca/descricao_original. É o
// "candidato a experimentação: LLM puro vs. embeddings" do conceito §4.2 —
// fica isolado em matchProduto() para trocar depois sem mexer nas queries.

const BASE_JOINS = `
  FROM item i
  JOIN fatura f ON f.id = i.fatura_id
  JOIN loja  l ON l.id = f.loja_id
  LEFT JOIN sku_normalizado s ON s.id = i.sku_id
`;

// Fragmento WHERE + params para casar um produto em linguagem natural.
function matchProduto(produto) {
  const like = `%${String(produto).trim()}%`;
  return {
    sql: '(s.nome_canonico LIKE ? OR s.marca LIKE ? OR i.descricao_original LIKE ?)',
    params: [like, like, like],
  };
}

// 1) Compra mais recente de um produto: preço pago, loja e data.
//    Exclui não-produto; mantém clearance (é uma compra real) mas sinaliza-o.
export async function buscar_ultima_compra(db, { produto }) {
  const m = matchProduto(produto);
  const [rows] = await db.query(
    `SELECT
        COALESCE(s.nome_canonico, i.descricao_original) AS produto,
        i.preco_liquido   AS preco,
        i.preco_por_base,
        s.unidade_base,
        l.nome   AS loja,
        l.cadeia,
        DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data,
        i.is_clearance
     ${BASE_JOINS}
     WHERE ${m.sql} AND i.is_non_product = FALSE AND f.needs_review = FALSE
     ORDER BY f.data_compra DESC, i.id DESC
     LIMIT 1`,
    m.params,
  );
  return rows[0] ?? null;
}

// 2) Comparar preço entre lojas pela unidade-base, do mais barato ao mais caro.
//    Usa a observação MAIS RECENTE por loja. Exclui clearance e não-produto.
export async function comparar_precos_por_loja(db, { produto }) {
  const m = matchProduto(produto);
  const [rows] = await db.query(
    `SELECT cadeia, loja, preco_por_base, unidade_base, data FROM (
        SELECT
            l.id AS loja_id, l.cadeia, l.nome AS loja,
            i.preco_por_base, s.unidade_base, DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data,
            ROW_NUMBER() OVER (PARTITION BY l.id ORDER BY f.data_compra DESC, i.id DESC) AS rn
        ${BASE_JOINS}
        WHERE ${m.sql}
          AND i.is_clearance = FALSE
          AND i.is_non_product = FALSE
          AND i.preco_por_base IS NOT NULL
          AND f.needs_review = FALSE
     ) t
     WHERE rn = 1
     ORDER BY preco_por_base ASC`,
    m.params,
  );
  return rows;
}

// 3) Evolução do preço ao longo do tempo (preço por data e loja).
//    `desde` opcional (ISO 'YYYY-MM-DD'). Exclui clearance e não-produto.
export async function historico_preco(db, { produto, desde }) {
  const m = matchProduto(produto);
  const params = [...m.params];
  let filtroData = '';
  if (desde) {
    filtroData = 'AND DATE(f.data_compra) >= ?';
    params.push(desde);
  }
  const [rows] = await db.query(
    `SELECT
        DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data,
        l.cadeia, l.nome AS loja,
        i.preco_por_base, i.preco_liquido, s.unidade_base
     ${BASE_JOINS}
     WHERE ${m.sql}
       AND i.is_clearance = FALSE
       AND i.is_non_product = FALSE
       AND f.needs_review = FALSE
       ${filtroData}
     ORDER BY f.data_compra ASC`,
    params,
  );
  return rows;
}

// 4) Total gasto num produto, categoria ou no geral ('tudo'), num período.
//    Exclui não-produto (saco/taxa). Inclui clearance (é gasto real).
//    SUPOSIÇÃO: 'tudo' = total de gasto em produtos, não a fatura absoluta
//    (sacos/taxas ficam de fora). Reversível se preferires o total bruto.
export async function total_gasto(db, { alvo, periodo_inicio, periodo_fim }) {
  const fim = periodo_fim || new Date().toISOString().slice(0, 10);
  const params = [periodo_inicio, fim];
  let filtroAlvo = '';
  if (alvo && String(alvo).trim().toLowerCase() !== 'tudo') {
    const m = matchProduto(alvo);
    // alvo pode ser categoria OU produto — tenta ambos.
    filtroAlvo = `AND (s.categoria LIKE ? OR ${m.sql})`;
    params.push(`%${String(alvo).trim()}%`, ...m.params);
  }
  const [rows] = await db.query(
    `SELECT
        COALESCE(SUM(i.preco_liquido), 0) AS total,
        COUNT(*) AS n_itens
     ${BASE_JOINS}
     WHERE i.is_non_product = FALSE
       AND f.needs_review = FALSE
       AND DATE(f.data_compra) >= ?
       AND DATE(f.data_compra) <= ?
       ${filtroAlvo}`,
    params,
  );
  return {
    alvo: alvo ?? 'tudo',
    periodo_inicio,
    periodo_fim: fim,
    total: rows[0].total,
    n_itens: rows[0].n_itens,
  };
}

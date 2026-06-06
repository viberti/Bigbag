// As 4 funções de consulta (Bloco 3). Cada uma recebe `db` (pool OU ligação
// de transação — ambos têm .query) e devolve JSON simples/achatado, pronto a
// servir ao LLM para ele formular a resposta em português.
//
// Princípios (do conceito / schema):
//  - Comparações e histórico usam SEMPRE `preco_por_base` (€/kg, €/L, €/un).
//  - Excluem `is_clearance` (fim de validade) e `is_non_product` (saco/taxa).
//  - A correspondência "produto em linguagem natural" → SKU é do BACKEND.
//
// Correspondência produto→SKU (isolada em matchProduto(), para trocar sem mexer
// nas queries): LIKE sobre nome_canonico/marca/categoria/descricao_original
// (apanha fragmentos: "café" → "Café Moído Delta") + expansão de sinónimos para
// categorias amplas. FALLBACK fuzzy ao nível do caractere (Levenshtein) quando o
// LIKE não acha nenhum SKU: apanha plural/typo/truncagem do utilizador
// ("manteigas"→"manteiga", "iorgute"→"iogurte") sem o custo de embeddings.
import { similaridadeTermo } from './normaliza/similaridade.js';

// Limiar do fallback fuzzy: ≥ casa; abaixo ignora (evita falsos positivos).
const LIMIAR_FUZZY = 0.7;

const BASE_JOINS = `
  FROM item i
  JOIN fatura f ON f.id = i.fatura_id
  JOIN loja  l ON l.id = f.loja_id
  LEFT JOIN sku_normalizado s ON s.id = i.sku_id
`;

const normaliza = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

// Termos amplos → conjunto de palavras a casar (em nome/categoria/descrição).
// As categorias reais são livres e dispersas (ex. álcool em "Bebidas Alcoólicas"
// E "Garrafeira"), por isso expandimos para apanhar todas. Extensível.
const SINONIMOS = {
  'bebida alcoolica': ['alcoolic', 'garrafeira', 'vinho', 'cerveja', 'whisky', 'gin', 'vodka', 'licor', 'espumante', 'aguardente', 'porto', 'sidra', 'martini', 'sangria'],
  alcool: ['alcoolic', 'garrafeira', 'vinho', 'cerveja', 'whisky', 'gin', 'vodka', 'licor', 'espumante', 'aguardente', 'porto', 'sidra'],
  limpeza: ['limpeza', 'detergente', 'lixivia', 'sabao', 'amaciador'],
  higiene: ['higiene', 'champo', 'gel de banho', 'sabonete', 'pasta de dentes', 'escova', 'cosmetic'],
  laticinios: ['laticinio', 'leite', 'iogurte', 'queijo', 'manteiga', 'natas', 'requeijao'],
  pastelaria: ['pastelaria', 'padaria', 'bolo', 'napolitana', 'croissant', 'folhado', 'queque', 'pao de deus'],
};

export function expandirAlvo(alvo) {
  const a = normaliza(alvo);
  for (const [chave, termos] of Object.entries(SINONIMOS)) {
    if (a === chave || a.includes(chave) || chave.includes(a)) return termos;
  }
  return [String(alvo).trim()];
}

// Fragmento WHERE + params para casar um produto/categoria em linguagem natural.
// Procura em nome_canonico, marca, categoria e descricao_original, com expansão
// de sinónimos para termos amplos.
async function matchProduto(db, produto) {
  const termos = expandirAlvo(produto);
  const conds = [];
  const params = [];
  for (const t of termos) {
    const like = `%${t}%`;
    conds.push('(s.nome_canonico LIKE ? OR s.marca LIKE ? OR s.categoria LIKE ? OR i.descricao_original LIKE ?)');
    params.push(like, like, like, like);
  }
  // Fallback fuzzy: só para alvo ÚNICO (não para categorias já expandidas) e
  // termos com ≥4 letras (curtos, o LIKE substring já chega). Resolve sku_ids
  // por semelhança de caractere e injeta-os no match.
  if (db && termos.length === 1) {
    const ids = await resolverFuzzy(db, produto);
    if (ids.length) {
      conds.push(`i.sku_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  return { sql: `(${conds.join(' OR ')})`, params };
}

// Encontra sku_ids cujo nome canónico se PARECE com o termo (Levenshtein), mas
// SÓ quando o LIKE não acha nenhum SKU — assim não corre no caso comum nem
// adiciona ruído quando o match normal já funciona. Tabela de SKUs é pequena.
async function resolverFuzzy(db, produto) {
  const termo = normaliza(produto).replace(/\s+/g, '');
  if (termo.length < 4) return []; // termos curtos: o LIKE substring resolve
  const like = `%${String(produto).trim()}%`;
  const [hit] = await db.query(
    'SELECT 1 FROM sku_normalizado WHERE nome_canonico LIKE ? OR marca LIKE ? OR categoria LIKE ? LIMIT 1',
    [like, like, like],
  );
  if (hit.length) return []; // o LIKE já casa um SKU → sem fuzzy
  const [skus] = await db.query('SELECT id, nome_canonico FROM sku_normalizado');
  const ids = [];
  for (const s of skus) if (similaridadeTermo(produto, s.nome_canonico) >= LIMIAR_FUZZY) ids.push(s.id);
  return ids;
}

// Fragmento de filtro por loja/cadeia (opcional).
function matchLoja(loja) {
  if (!loja || !String(loja).trim()) return { sql: '', params: [] };
  const like = `%${String(loja).trim()}%`;
  return { sql: 'AND (l.cadeia LIKE ? OR l.nome LIKE ?)', params: [like, like] };
}

// 1) Compra mais recente de um produto: preço pago, loja e data.
//    Exclui não-produto; mantém clearance (é uma compra real) mas sinaliza-o.
export async function buscar_ultima_compra(db, { produto }) {
  const m = await matchProduto(db, produto);
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
  const m = await matchProduto(db, produto);
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

// 8) Produtos que o usuário compra COM FREQUÊNCIA (em várias idas distintas) —
//    a "lista de compras habitual". idas = nº de compras distintas; meses = nº
//    de meses distintos. Para "o que compro habitualmente", "todo mês".
export async function produtos_habituais(db, { min_idas, periodo_inicio, periodo_fim, loja } = {}) {
  const inicio = periodo_inicio || '1900-01-01';
  const fim = periodo_fim || new Date().toISOString().slice(0, 10);
  const minIdas = Math.max(2, Number(min_idas) || 2);
  const ml = matchLoja(loja);
  const [rows] = await db.query(
    `SELECT COALESCE(s.nome_simplificado, s.nome_canonico, i.descricao_original) AS produto,
            MAX(s.categoria) AS categoria,
            COUNT(DISTINCT f.id) AS idas,
            COUNT(DISTINCT DATE_FORMAT(f.data_compra, '%Y-%m')) AS meses,
            COUNT(*) AS unidades,
            ROUND(SUM(i.preco_liquido), 2) AS total,
            CAST(SUBSTRING_INDEX(GROUP_CONCAT(i.preco_liquido ORDER BY f.data_compra DESC), ',', 1) AS DECIMAL(10,2)) AS ultimo_preco
     ${BASE_JOINS}
     WHERE i.is_non_product = FALSE
       AND f.needs_review = FALSE
       AND DATE(f.data_compra) >= ?
       AND DATE(f.data_compra) <= ?
       ${ml.sql}
     GROUP BY produto
     HAVING idas >= ?
     ORDER BY idas DESC, meses DESC, unidades DESC
     LIMIT 40`,
    [inicio, fim, ...ml.params, minIdas],
  );
  return rows;
}

// 7) Detalhes de uma fatura específica (itens e preços impressos). Sem filtros
//    devolve a MAIS RECENTE adicionada; ou filtra por loja/data. Para "os
//    valores da última fatura estão certos?", "o que comprei na fatura de X".
export async function detalhes_fatura(db, { loja, data } = {}) {
  const cond = [];
  const params = [];
  if (loja && String(loja).trim()) {
    cond.push('(l.cadeia LIKE ? OR l.nome LIKE ?)');
    params.push(`%${loja}%`, `%${loja}%`);
  }
  if (data) {
    cond.push('DATE(f.data_compra) = ?');
    params.push(data);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const [fats] = await db.query(
    `SELECT f.id, l.cadeia, l.nome AS loja, DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data,
            f.total_impresso AS total, f.needs_review, f.metodo_extracao AS metodo
     FROM fatura f JOIN loja l ON l.id = f.loja_id
     ${where}
     ORDER BY f.criado_em DESC LIMIT 1`,
    params,
  );
  if (!fats.length) return { encontrada: false };
  const f = fats[0];
  const [itens] = await db.query(
    `SELECT COALESCE(s.nome_canonico, i.descricao_original) AS produto,
            i.descricao_original, COALESCE(i.preco_unitario, i.preco_liquido) AS preco
     FROM item i LEFT JOIN sku_normalizado s ON s.id = i.sku_id
     WHERE i.fatura_id = ? ORDER BY i.id`,
    [f.id],
  );
  return {
    encontrada: true,
    loja: f.loja,
    cadeia: f.cadeia,
    data: f.data,
    total: f.total,
    em_revisao: !!f.needs_review,
    metodo_extracao: f.metodo,
    itens,
  };
}

// 6) Produto(s) mais barato(s) que casam com um termo (produto OU categoria),
//    pelo preço por unidade-base — do mais barato ao mais caro. Uma linha por
//    produto (observação mais recente). Para "qual o queijo mais barato".
export async function produto_mais_barato(db, { alvo, loja }) {
  const m = await matchProduto(db, alvo);
  const ml = matchLoja(loja);
  const [rows] = await db.query(
    `SELECT cadeia, loja, produto, preco_por_base, unidade_base, data FROM (
        SELECT l.cadeia, l.nome AS loja,
               COALESCE(s.nome_canonico, i.descricao_original) AS produto,
               i.preco_por_base, s.unidade_base,
               DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data,
               ROW_NUMBER() OVER (PARTITION BY COALESCE(s.nome_canonico, i.descricao_original)
                                  ORDER BY f.data_compra DESC, i.id DESC) AS rn
        ${BASE_JOINS}
        WHERE ${m.sql}
          AND i.is_clearance = FALSE AND i.is_non_product = FALSE AND f.needs_review = FALSE
          AND i.preco_por_base IS NOT NULL
          ${ml.sql}
     ) t
     WHERE rn = 1
     ORDER BY preco_por_base ASC
     LIMIT 10`,
    [...m.params, ...ml.params],
  );
  return rows;
}

// 3) Evolução do preço ao longo do tempo (preço por data e loja).
//    `desde` opcional (ISO 'YYYY-MM-DD'). Exclui clearance e não-produto.
export async function historico_preco(db, { produto, desde }) {
  const m = await matchProduto(db, produto);
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

// 5) Listar o que foi comprado num período (itens com data, loja e preço).
//    Opcionalmente filtrado por produto/categoria. Exclui não-produto e revisão.
export async function listar_compras(db, { periodo_inicio, periodo_fim, alvo, loja, agrupar_por }) {
  const inicio = periodo_inicio || '1900-01-01';
  const fim = periodo_fim || new Date().toISOString().slice(0, 10);
  const params = [inicio, fim];
  let filtroAlvo = '';
  if (alvo && normaliza(alvo) !== 'tudo') {
    const m = await matchProduto(db, alvo);
    filtroAlvo = `AND ${m.sql}`;
    params.push(...m.params);
  }
  const ml = matchLoja(loja);
  params.push(...ml.params);

  const onde = `WHERE i.is_non_product = FALSE AND f.needs_review = FALSE
       AND DATE(f.data_compra) >= ? AND DATE(f.data_compra) <= ? ${filtroAlvo} ${ml.sql}`;

  // Modo PRODUTO: agrega por produto (soma fiável), sem loja/data — para
  // perguntas focadas nos produtos. Default 'item' = linha-a-linha (por ida).
  if (String(agrupar_por).toLowerCase() === 'produto') {
    const [rows] = await db.query(
      `SELECT COALESCE(s.nome_canonico, i.descricao_original) AS produto,
              COUNT(*) AS vezes,
              ROUND(SUM(i.preco_liquido), 2) AS total
       ${BASE_JOINS}
       ${onde}
       GROUP BY produto
       ORDER BY total DESC`,
      params,
    );
    return rows;
  }

  const [rows] = await db.query(
    `SELECT
        DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data,
        l.cadeia, l.nome AS loja,
        COALESCE(s.nome_canonico, i.descricao_original) AS produto,
        i.preco_liquido
     ${BASE_JOINS}
     ${onde}
     ORDER BY f.data_compra, l.nome, i.id`,
    params,
  );
  return rows;
}

// 4) Total gasto num produto, categoria ou no geral ('tudo'), num período.
//    Exclui não-produto (saco/taxa). Inclui clearance (é gasto real).
//    SUPOSIÇÃO: 'tudo' = total de gasto em produtos, não a fatura absoluta
//    (sacos/taxas ficam de fora). Reversível se preferires o total bruto.
export async function total_gasto(db, { alvo, periodo_inicio, periodo_fim, loja }) {
  const inicio = periodo_inicio || '1900-01-01'; // sem período → todo o histórico
  const fim = periodo_fim || new Date().toISOString().slice(0, 10);
  const params = [inicio, fim];
  let filtroAlvo = '';
  if (alvo && normaliza(alvo) !== 'tudo') {
    const m = await matchProduto(db, alvo); // procura nome/marca/categoria/descrição (+ sinónimos)
    filtroAlvo = `AND ${m.sql}`;
    params.push(...m.params);
  }
  const ml = matchLoja(loja);
  params.push(...ml.params);
  const [rows] = await db.query(
    `SELECT
        COALESCE(SUM(i.preco_liquido), 0) AS total,
        COUNT(*) AS n_itens
     ${BASE_JOINS}
     WHERE i.is_non_product = FALSE
       AND f.needs_review = FALSE
       AND DATE(f.data_compra) >= ?
       AND DATE(f.data_compra) <= ?
       ${filtroAlvo}
       ${ml.sql}`,
    params,
  );
  return {
    alvo: alvo ?? 'tudo',
    loja: loja ?? null,
    periodo_inicio: inicio,
    periodo_fim: fim,
    total: rows[0].total,
    n_itens: rows[0].n_itens,
  };
}

// 9) Tendência: produtos que ficaram MAIS CAROS ou MAIS BARATOS. Para cada
//    produto com ≥2 observações de preco_por_base (em datas diferentes), compara
//    a 1ª e a última e calcula a variação %. Devolve os maiores movimentos.
//    Para "ultimamente", o LLM passa `desde` (ex.: 90 dias atrás).
export async function tendencia_precos(db, { desde, loja } = {}) {
  const ml = matchLoja(loja);
  const params = [];
  let filtroData = '';
  if (desde) {
    filtroData = 'AND DATE(f.data_compra) >= ?';
    params.push(desde);
  }
  params.push(...ml.params);
  const [rows] = await db.query(
    `SELECT produto, unidade_base, preco_antigo, data_antiga, preco_novo, data_nova,
            ROUND(100 * (preco_novo - preco_antigo) / preco_antigo, 1) AS variacao_pct
     FROM (
       SELECT COALESCE(s.nome_canonico, i.descricao_original) AS produto,
              s.unidade_base,
              FIRST_VALUE(i.preco_por_base) OVER w_asc AS preco_antigo,
              FIRST_VALUE(DATE_FORMAT(f.data_compra, '%Y-%m-%d')) OVER w_asc AS data_antiga,
              FIRST_VALUE(i.preco_por_base) OVER w_desc AS preco_novo,
              FIRST_VALUE(DATE_FORMAT(f.data_compra, '%Y-%m-%d')) OVER w_desc AS data_nova,
              COUNT(*) OVER (PARTITION BY COALESCE(s.nome_canonico, i.descricao_original)) AS n,
              ROW_NUMBER() OVER w_asc AS rn
       ${BASE_JOINS}
       WHERE i.is_clearance = FALSE AND i.is_non_product = FALSE AND f.needs_review = FALSE
         AND i.preco_por_base IS NOT NULL
         ${filtroData} ${ml.sql}
       WINDOW
         w_asc  AS (PARTITION BY COALESCE(s.nome_canonico, i.descricao_original) ORDER BY f.data_compra ASC,  i.id ASC),
         w_desc AS (PARTITION BY COALESCE(s.nome_canonico, i.descricao_original) ORDER BY f.data_compra DESC, i.id DESC)
     ) t
     WHERE rn = 1 AND n >= 2 AND preco_antigo > 0 AND data_nova > data_antiga
     ORDER BY ABS((preco_novo - preco_antigo) / preco_antigo) DESC
     LIMIT 15`,
    params,
  );
  return rows;
}

// 10) Que CADEIA tende a ser mais barata para os produtos do usuário. Para cada
//     produto presente em ≥2 cadeias, compara o preco_por_base (mais recente por
//     cadeia) ao mínimo; ordena as cadeias pelo "prémio médio" sobre o mais
//     barato (menor = tende a ser mais barata). Honesto: só conta produtos
//     comparáveis (vistos em ≥2 cadeias). Se não houver, devolve vazio.
export async function comparar_lojas(db, {} = {}) {
  const [rows] = await db.query(
    `WITH recente AS (
       SELECT COALESCE(s.nome_canonico, i.descricao_original) AS produto, l.cadeia, i.preco_por_base,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(s.nome_canonico, i.descricao_original), l.cadeia
                                 ORDER BY f.data_compra DESC, i.id DESC) AS rn
       ${BASE_JOINS}
       WHERE i.is_clearance = FALSE AND i.is_non_product = FALSE AND f.needs_review = FALSE
         AND i.preco_por_base IS NOT NULL
     ),
     comp AS (
       SELECT produto, cadeia, preco_por_base,
              MIN(preco_por_base) OVER (PARTITION BY produto) AS min_preco,
              COUNT(*) OVER (PARTITION BY produto) AS n_cadeias
       FROM recente WHERE rn = 1
     )
     SELECT cadeia,
            COUNT(*) AS produtos_comparados,
            SUM(preco_por_base = min_preco) AS vezes_mais_barata,
            ROUND(100 * SUM(preco_por_base = min_preco) / COUNT(*)) AS vitorias_pct,
            -- prémio médio sobre o mais barato, limitado a 100%/produto para um
            -- outlier (ruído de formato) não dominar a média.
            ROUND(AVG(100 * LEAST((preco_por_base - min_preco) / min_preco, 1.0)), 1) AS premio_medio_pct
     FROM comp
     WHERE n_cadeias >= 2
     GROUP BY cadeia
     ORDER BY vitorias_pct DESC, premio_medio_pct ASC`,
  );
  return rows;
}

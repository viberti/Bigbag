import { classificarLoja } from './classify.js';

// Persiste uma fatura extraída + reconciliada. Tudo numa transação.
// Loja: upsert por NIF (chave natural). Itens: sku_id e preco_por_base ficam
// NULL — a normalização de SKU (e o €/unidade-base) é um passo separado, a
// correr depois sobre descricao_original (conceito §4.2).

async function upsertLoja(conn, loja) {
  const cadeia = loja?.cadeia || 'Desconhecida';
  const nome = loja?.nome || cadeia;
  const nif = loja?.nif || null;
  const localizacao = loja?.localizacao || null;
  const tipo = classificarLoja({ cadeia, nome });

  if (nif) {
    const [found] = await conn.query('SELECT id FROM loja WHERE nif = ?', [nif]);
    if (found.length) return found[0].id;
  } else {
    const [found] = await conn.query('SELECT id FROM loja WHERE cadeia = ? AND nome = ? LIMIT 1', [cadeia, nome]);
    if (found.length) return found[0].id;
  }
  const [r] = await conn.query(
    'INSERT INTO loja (cadeia, tipo, nome, nif, localizacao) VALUES (?,?,?,?,?)',
    [cadeia, tipo, nome, nif, localizacao],
  );
  return r.insertId;
}

// `dados` já vem reconciliado: itens com preco_unitario e preco_liquido.
export async function persistirFatura(
  pool,
  dados,
  { ficheiroOriginal = null, metodo = 'vlm', totalReconciliado, discrepancia = null, needsReview = false, extracaoJson = null } = {},
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const lojaId = await upsertLoja(conn, dados.loja);

    const [rf] = await conn.query(
      `INSERT INTO fatura
         (loja_id, data_compra, total_impresso, total_reconciliado, discrepancia, needs_review,
          desconto_global, ficheiro_original, metodo_extracao, extracao_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        lojaId,
        toMysqlDate(dados.data_compra),
        num(dados.total_impresso),
        totalReconciliado != null ? num(totalReconciliado) : null,
        discrepancia != null ? num(discrepancia) : null,
        needsReview ? 1 : 0,
        num(dados.desconto_global) || 0,
        ficheiroOriginal,
        metodo,
        extracaoJson != null ? JSON.stringify(extracaoJson) : null,
      ],
    );
    const faturaId = rf.insertId;

    for (const it of dados.itens) {
      await conn.query(
        `INSERT INTO item
           (fatura_id, sku_id, descricao_original, quantidade, preco_unitario, preco_liquido,
            preco_por_base, is_clearance, desconto_direto, is_non_product)
         VALUES (?, NULL, ?, 1, ?, ?, NULL, ?, ?, ?)`,
        [
          faturaId,
          String(it.descricao_original || '').slice(0, 200),
          num(it.preco_unitario),
          num(it.preco_liquido),
          it.is_clearance ? 1 : 0,
          num(it.desconto_direto) || 0,
          it.is_non_product ? 1 : 0,
        ],
      );
    }

    await conn.commit();
    return { fatura_id: faturaId, loja_id: lojaId, n_itens: dados.itens.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMysqlDate(iso) {
  // 'YYYY-MM-DDTHH:mm:ss' → 'YYYY-MM-DD HH:mm:ss'; aceita só data também.
  if (!iso) return null;
  const s = String(iso).replace('T', ' ').slice(0, 19);
  return s.length === 10 ? `${s} 00:00:00` : s;
}

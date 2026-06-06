import { classificarLoja } from './classify.js';

// Persiste uma fatura extraída + reconciliada. Tudo numa transação.
// Loja: upsert por NIF (chave natural). `preco_por_base` já vem calculado
// (Camada 1, na rota). `sku_id` é gravado NULL aqui e resolvido logo a seguir,
// FORA da transação, por normalizarItensFatura (faz chamadas ao LLM); o script
// de lote normalizar_skus é a rede de segurança.

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
  {
    ficheiroOriginal = null,
    metodo = 'vlm',
    modelo = null,
    origemCaptura = null,
    totalReconciliado,
    discrepancia = null,
    needsReview = false,
    extracaoJson = null,
  } = {},
) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const lojaId = await upsertLoja(conn, dados.loja);

    // Deduplicação (mesma loja): nº de documento OU data+total. O "OU" apanha
    // tanto faturas novas (com número) como as antigas (número ainda NULL).
    const numero = dados.numero_fatura ? String(dados.numero_fatura).trim().slice(0, 60) : null;
    const data = toMysqlDate(dados.data_compra);
    const total = num(dados.total_impresso);
    const [dup] = await conn.query(
      `SELECT id FROM fatura
        WHERE loja_id = ?
          AND ( (? IS NOT NULL AND numero_fatura = ?) OR (data_compra = ? AND total_impresso = ?) )
        LIMIT 1`,
      [lojaId, numero, numero, data, total],
    );
    if (dup.length) {
      await conn.rollback();
      return { duplicada: true, fatura_id: dup[0].id, loja_id: lojaId };
    }

    const [rf] = await conn.query(
      `INSERT INTO fatura
         (loja_id, data_compra, numero_fatura, total_impresso, total_reconciliado, discrepancia, needs_review,
          desconto_global, ficheiro_original, metodo_extracao, origem_captura, modelo, extracao_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        lojaId,
        data,
        numero,
        total,
        totalReconciliado != null ? num(totalReconciliado) : null,
        discrepancia != null ? num(discrepancia) : null,
        needsReview ? 1 : 0,
        num(dados.desconto_global) || 0,
        ficheiroOriginal,
        metodo,
        origemCaptura,
        modelo,
        extracaoJson != null ? JSON.stringify(extracaoJson) : null,
      ],
    );
    const faturaId = rf.insertId;

    for (const it of dados.itens) {
      await conn.query(
        `INSERT INTO item
           (fatura_id, sku_id, descricao_original, linha_peso, quantidade, preco_unitario, preco_liquido,
            preco_por_base, is_clearance, desconto_direto, is_non_product)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          faturaId,
          String(it.descricao_original || '').slice(0, 200),
          it.linha_peso ? String(it.linha_peso).slice(0, 80) : null,
          num(it.quantidade) || 1,
          num(it.preco_unitario),
          num(it.preco_liquido),
          it.preco_por_base != null ? num(it.preco_por_base) : null,
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

import { classificarLoja } from './classify.js';
import { eanValido } from './produto.js';

// Persiste uma fatura extraída + reconciliada. Tudo numa transação.
// Loja: upsert por NIF (chave natural). `preco_por_base` já vem calculado
// (Camada 1, na rota). `sku_id` é gravado NULL aqui e resolvido logo a seguir,
// FORA da transação, por normalizarItensFatura (faz chamadas ao LLM); o script
// de lote normalizar_skus é a rede de segurança.

async function upsertLoja(conn, loja) {
  const cadeia = loja?.cadeia || 'Desconhecida';
  const nome = loja?.nome || cadeia;
  // O VLM lê o NIF ora "501591109" ora "PT501591109" → só os dígitos contam,
  // senão a mesma loja entra duplicada.
  const nif = loja?.nif ? String(loja.nif).replace(/\D/g, '') || null : null;
  const localizacao = loja?.localizacao || null;
  const tipo = classificarLoja({ cadeia, nome });

  if (nif) {
    const [found] = await conn.query("SELECT id FROM loja WHERE REPLACE(COALESCE(nif,''),'PT','') = ?", [nif]);
    if (found.length) return found[0].id;
  }
  // Cair sempre para cadeia+nome: um NIF mal lido pelo VLM não pode criar loja nova.
  const [found] = await conn.query('SELECT id, nif FROM loja WHERE cadeia = ? AND nome = ? LIMIT 1', [cadeia, nome]);
  if (found.length) {
    if (nif && !found[0].nif) await conn.query('UPDATE loja SET nif = ? WHERE id = ?', [nif, found[0].id]);
    return found[0].id;
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
    const cadeia = dados.loja?.cadeia ? String(dados.loja.cadeia).trim() : null;

    // Dedup por NÚMERO do documento (o critério mais fiável) — por CADEIA, para
    // sobreviver a nome de loja mal lido (loja_id diferente). O nº já é único por talão.
    if (numero && cadeia) {
      const [byNum] = await conn.query(
        `SELECT f.id FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE l.cadeia = ? AND f.numero_fatura = ? LIMIT 1`,
        [cadeia, numero],
      );
      if (byNum.length) {
        await conn.rollback();
        return { duplicada: true, fatura_id: byNum[0].id, loja_id: lojaId };
      }
    }

    const [dup] = await conn.query(
      `SELECT id FROM fatura
        WHERE loja_id = ?
          AND ( (? IS NOT NULL AND numero_fatura = ?) OR (DATE(data_compra) = DATE(?) AND total_impresso = ?) )
        LIMIT 1`,
      [lojaId, numero, numero, data, total],
    );
    if (dup.length) {
      await conn.rollback();
      return { duplicada: true, fatura_id: dup[0].id, loja_id: lojaId };
    }

    // Dedup ROBUSTA (rede 2): apanha duplicados que escapam acima quando o VLM lê
    // mal o NOME da loja (→ loja_id diferente) ou a DATA (→ data não bate). Chave
    // estável: cadeia + total + nº de itens, CONFIRMADA por sobreposição de preços
    // (tolerante a cêntimos de OCR). Foi assim que 3 duplicados do Mercadona —
    // lido como "Irmadona", com datas erradas — passaram despercebidos.
    const precos = dados.itens.map((i) => num(i.preco_liquido)).filter((x) => x != null);

    // Dedup por ASSINATURA FORTE: cadeia + MESMA DATA + total + nº de itens. É
    // praticamente impossível haver duas compras distintas com isto tudo igual.
    // Apanha os casos que a rede 2 falha por os preços terem sido lidos de forma
    // diferente entre as duas leituras (ex.: foto em revisão do ALDI; PDFs reenviados).
    if (cadeia && total != null && data) {
      const [sig] = await conn.query(
        `SELECT f.id FROM fatura f JOIN loja l ON l.id = f.loja_id
          WHERE l.cadeia = ? AND DATE(f.data_compra) = DATE(?) AND f.total_impresso = ?
            AND (SELECT COUNT(*) FROM item it WHERE it.fatura_id = f.id) = ?
          LIMIT 1`,
        [cadeia, data, total, dados.itens.length],
      );
      if (sig.length) {
        await conn.rollback();
        return { duplicada: true, fatura_id: sig[0].id, loja_id: lojaId };
      }
    }

    if (cadeia && total != null && precos.length) {
      const [cands] = await conn.query(
        `SELECT f.id, (SELECT COUNT(*) FROM item it WHERE it.fatura_id = f.id) AS n
           FROM fatura f JOIN loja l ON l.id = f.loja_id
          WHERE l.cadeia = ? AND f.total_impresso = ?
          HAVING n = ?`,
        [cadeia, total, dados.itens.length],
      );
      for (const c of cands) {
        const [its] = await conn.query('SELECT preco_liquido FROM item WHERE fatura_id = ?', [c.id]);
        const overlap = sobreposicaoPrecos(precos, its.map((x) => Number(x.preco_liquido)));
        if (overlap >= Math.ceil(precos.length * 0.7)) {
          await conn.rollback();
          return { duplicada: true, fatura_id: c.id, loja_id: lojaId };
        }
      }
    }

    // B5: NIF do comprador (atribuição ao membro) e forma de pagamento — campos
    // que o talão dá de graça. NIF normalizado a dígitos; pagamento numa whitelist.
    const nifComprador = String(dados.nif_comprador || '').replace(/\D/g, '').slice(0, 20) || null;
    const formaPag = ['dinheiro', 'cartao', 'mbway', 'outro'].includes(String(dados.forma_pagamento || '').toLowerCase())
      ? String(dados.forma_pagamento).toLowerCase() : null;
    const [rf] = await conn.query(
      `INSERT INTO fatura
         (loja_id, data_compra, numero_fatura, nif_comprador, forma_pagamento, total_impresso, total_reconciliado, discrepancia, needs_review,
          desconto_global, precos_com_iva, ficheiro_original, metodo_extracao, origem_captura, modelo, extracao_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        lojaId,
        data,
        numero,
        nifComprador,
        formaPag,
        total,
        totalReconciliado != null ? num(totalReconciliado) : null,
        discrepancia != null ? num(discrepancia) : null,
        needsReview ? 1 : 0,
        num(dados.desconto_global) || 0,
        num(dados.iva) > 0 ? 0 : 1, // preços SEM IVA (grossista) → 0; supermercado → 1
        ficheiroOriginal,
        metodo,
        origemCaptura,
        modelo,
        extracaoJson != null ? JSON.stringify(extracaoJson) : null,
      ],
    );
    const faturaId = rf.insertId;

    for (const it of dados.itens) {
      const eanItem = it.ean ? String(it.ean).replace(/\D/g, '') : null;
      await conn.query(
        `INSERT INTO item
           (fatura_id, sku_id, descricao_original, ean, linha_peso, quantidade, preco_unitario, preco_liquido,
            preco_por_base, taxa_iva, is_clearance, desconto_direto, is_non_product)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          faturaId,
          String(it.descricao_original || '').slice(0, 200),
          eanItem && eanValido(eanItem) ? eanItem : null, // só EAN com dígito verificador válido
          it.linha_peso ? String(it.linha_peso).slice(0, 80) : null,
          num(it.quantidade) || 1,
          num(it.preco_unitario),
          num(it.preco_liquido),
          it.preco_por_base != null ? num(it.preco_por_base) : null,
          it.taxa_iva != null ? num(it.taxa_iva) : null,
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

// Tamanho da interseção de dois multiconjuntos de preços, com tolerância de ±0,02
// (cêntimos de OCR: 2,55 ≈ 2,56). Cada preço de A consome no máximo um de B.
export function sobreposicaoPrecos(a, b, tol = 0.02) {
  const restantes = b.map((x) => Number(x)).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  let n = 0;
  for (const p of a.map(Number).filter(Number.isFinite).sort((x, y) => x - y)) {
    const i = restantes.findIndex((q) => Math.abs(q - p) <= tol);
    if (i >= 0) { restantes.splice(i, 1); n++; }
  }
  return n;
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

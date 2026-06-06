// Reprocessar uma nota JÁ guardada: re-corre a extração sobre o mesmo ficheiro
// (apanha melhorias de prompt/reconciliação retroativamente) e substitui os
// itens + atualiza os campos da fatura. A loja, o ficheiro e as revisões
// anteriores mantêm-se. ATENÇÃO: substitui os itens — edições manuais de
// quantidade nessa nota perdem-se (o operador está a re-ler de propósito). Os
// aliases (incl. manuais) são preservados: os itens novos re-resolvem pela cache.
import { readFile } from 'node:fs/promises';
import { extrairFatura, extrairFaturaDeTexto } from './extract.js';
import { extrairTextoPdf } from './pdf.js';
import { preProcessarImagem } from './imagem.js';
import { distribuirDesconto, validarLinhas } from './reconcile.js';
import { extrairFormato, precoPorBase } from '../normaliza/formato.js';
import { normalizarItensFatura } from '../normaliza/matcher.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export async function reprocessarFatura(pool, faturaId) {
  const [[f]] = await pool.query(
    'SELECT f.ficheiro_original, f.metodo_extracao, l.cadeia FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.id = ?',
    [faturaId],
  );
  if (!f?.ficheiro_original) throw new Error('Nota sem ficheiro guardado');
  const buf = await readFile(f.ficheiro_original);
  const ehPdf = f.metodo_extracao === 'ocr_llm' || /\.pdf$/i.test(f.ficheiro_original);

  let dados;
  if (ehPdf) dados = await extrairFaturaDeTexto(await extrairTextoPdf(buf));
  else {
    const img = await preProcessarImagem(buf);
    dados = await extrairFatura({ imageBase64: img.buffer.toString('base64'), mime: img.mime });
  }

  const rec = distribuirDesconto(dados.itens, {
    descontoGlobal: num(dados.desconto_global) || 0,
    totalImpresso: dados.total_impresso,
    iva: num(dados.iva) || 0,
  });
  const linhasInc = validarLinhas(dados.itens);
  const itens = rec.itens;
  for (const it of itens) {
    if (it.is_non_product) {
      it.preco_por_base = null;
      continue;
    }
    const fmt = extrairFormato([it.descricao_original, it.linha_peso].filter(Boolean).join(' '));
    it.preco_por_base = precoPorBase({ preco_liquido: it.preco_liquido, quantidade: it.quantidade }, fmt);
  }
  const extracaoJson = {
    loja: dados.loja,
    data_compra: dados.data_compra,
    subtotal: dados.subtotal,
    desconto_global: dados.desconto_global,
    iva: dados.iva,
    total_impresso: dados.total_impresso,
    itens: dados.itens,
  };
  const needsReview = !rec.extracaoBate || linhasInc.length > 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM item WHERE fatura_id = ?', [faturaId]);
    for (const it of itens) {
      await conn.query(
        `INSERT INTO item (fatura_id, sku_id, descricao_original, quantidade, preco_unitario, preco_liquido,
           preco_por_base, is_clearance, desconto_direto, is_non_product)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          faturaId,
          String(it.descricao_original || '').slice(0, 200),
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
    await conn.query(
      `UPDATE fatura SET total_impresso = ?, total_reconciliado = ?, discrepancia = ?, needs_review = ?,
         desconto_global = ?, extracao_json = ? WHERE id = ?`,
      [
        num(dados.total_impresso),
        num(rec.totalReconciliado),
        num(rec.discrepancia),
        needsReview ? 1 : 0,
        num(dados.desconto_global) || 0,
        JSON.stringify(extracaoJson),
        faturaId,
      ],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // Re-resolve os SKUs (com contexto da cadeia). Best-effort.
  await normalizarItensFatura(pool, faturaId, { cadeia: f.cadeia }).catch(() => {});

  return { fatura_id: faturaId, n_itens: itens.length, needs_review: needsReview, discrepancia: rec.discrepancia };
}

// Recomputa o preco_por_base de itens RESPEITANDO o unidade_base do SKU
// (autoritativo). Deriva o formato de descricao_original + linha_peso (peso de
// balcão). Itens sem SKU caem para a unidade do formato (retrocompatível).
import { extrairFormato, precoPorBase } from './formato.js';

const COLS = `i.id, i.descricao_original, i.linha_peso, i.preco_liquido, i.quantidade, i.is_non_product, i.ppb_inferido, i.taxa_iva, f.precos_com_iva, s.unidade_base`;

async function recomp(db, rows) {
  for (const r of rows) {
    if (r.ppb_inferido) continue; // valor inferido pela auto-correção — não sobrescrever
    if (r.is_non_product) {
      await db.query('UPDATE item SET preco_por_base = NULL, peso_em_falta = 0 WHERE id = ?', [r.id]);
      continue;
    }
    const fmt = extrairFormato([r.descricao_original, r.linha_peso].filter(Boolean).join(' '));
    let ppb = precoPorBase({ preco_liquido: r.preco_liquido, quantidade: r.quantidade }, fmt, r.unidade_base || undefined);
    // Preços SEM IVA (grossista, precos_com_iva=0) → converte para o preço FINAL
    // (× (1+taxa)) para comparar com supermercados, que já imprimem com IVA.
    if (ppb != null && !r.precos_com_iva && r.taxa_iva != null) {
      ppb = Math.round(ppb * (1 + Number(r.taxa_iva)) * 10000) / 10000;
    }
    // Produto a peso/volume (kg/L) mas sem peso na nota → ppb incomputável (null):
    // marca peso_em_falta para excluir do €/kg sem fingir um valor por peça.
    const alvoKgL = r.unidade_base === 'kg' || r.unidade_base === 'L';
    const pesoEmFalta = alvoKgL && ppb == null ? 1 : 0;
    await db.query('UPDATE item SET preco_por_base = ?, peso_em_falta = ? WHERE id = ?', [ppb, pesoEmFalta, r.id]);
  }
  return rows.length;
}

export async function recomputarPpbFatura(db, faturaId) {
  const [rows] = await db.query(
    `SELECT ${COLS} FROM item i JOIN fatura f ON f.id = i.fatura_id
       LEFT JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.fatura_id = ?`,
    [faturaId],
  );
  return recomp(db, rows);
}

export async function recomputarPpbSku(db, skuId) {
  const [rows] = await db.query(
    `SELECT ${COLS} FROM item i JOIN fatura f ON f.id = i.fatura_id
       JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.sku_id = ?`,
    [skuId],
  );
  return recomp(db, rows);
}

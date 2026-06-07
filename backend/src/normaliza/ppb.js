// Recomputa o preco_por_base de itens RESPEITANDO o unidade_base do SKU
// (autoritativo). Deriva o formato de descricao_original + linha_peso (peso de
// balcão). Itens sem SKU caem para a unidade do formato (retrocompatível).
import { extrairFormato, precoPorBase } from './formato.js';

const COLS = `i.id, i.descricao_original, i.linha_peso, i.preco_liquido, i.quantidade, i.is_non_product, i.ppb_inferido, i.taxa_iva, f.precos_com_iva, s.unidade_base, s.formato_valor,
  (SELECT COUNT(*) FROM item it WHERE it.sku_id = i.sku_id AND it.linha_peso IS NOT NULL AND it.linha_peso <> '') AS sku_pesado`;

const round4 = (v) => Math.round(v * 10000) / 10000;
// Pacote FIXO fiável? SKU com tamanho real (formato_valor ≠ 1, não-default) que
// NUNCA é pesado ao balcão, e a linha não é venda-a-peso (KG/GRANEL) nem multipack
// ("6*", "4X200"). Então o tamanho do pacote é uma propriedade do produto e dá para
// derivar €/base mesmo quando a linha não traz peso. Ex.: "MIRTILO 500" (0,5 kg).
function pacoteFixoFiavel(r) {
  const fv = Number(r.formato_valor);
  const desc = String(r.descricao_original || '');
  return (
    Number.isFinite(fv) && fv > 0 && fv !== 1 && !r.sku_pesado &&
    !/\bKG\b|GRANEL/i.test(desc) && !/\d+\s*[*]|\d+\s*[xX]\s*\d/.test(desc)
  );
}

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
    // Produto a peso/volume (kg/L) sem peso na nota → ppb incomputável (null).
    const alvoKgL = r.unidade_base === 'kg' || r.unidade_base === 'L';
    let pesoEmFalta = 0;
    if (ppb == null && alvoKgL) {
      if (pacoteFixoFiavel(r)) {
        // Pacote fixo conhecido (ex.: mirtilo 500 g) → deriva €/base do tamanho.
        const emb = Number(r.quantidade) >= 1 ? Number(r.quantidade) : 1;
        ppb = round4(Number(r.preco_liquido) / (Number(r.formato_valor) * emb));
        if (!r.precos_com_iva && r.taxa_iva != null) ppb = round4(ppb * (1 + Number(r.taxa_iva)));
      } else {
        // Peso variável sem peso na nota → marca para excluir do €/kg (não inventa).
        pesoEmFalta = 1;
      }
    }
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

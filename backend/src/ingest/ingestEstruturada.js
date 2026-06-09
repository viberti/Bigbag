// Ingestão de uma fatura JÁ ESTRUTURADA (sem extração VLM/OCR) — ex.: talões
// digitais do Lidl Plus, que vêm em JSON com EAN por linha. Reaproveita o MESMO
// pipeline da rota de faturas: reconciliação → preco_por_base → persist (com
// deduplicação) → canonicalização → recompute ppb → auto-correção → merge de
// nomes → enriquecimento OFF dos EANs. Idempotente: o persist dedup por
// cadeia+numero_fatura, por isso re-importar o mesmo talão é no-op.
import { distribuirDesconto, validarLinhas } from './reconcile.js';
import { persistirFatura } from './persist.js';
import { enriquecerEansFatura } from './enriquecer.js';
import { extrairFormato, precoPorBase } from '../normaliza/formato.js';
import { normalizarItensFatura, mergeNomesIdenticos } from '../normaliza/matcher.js';
import { recomputarPpbFatura } from '../normaliza/ppb.js';
import { autoCorrigirOutliers } from '../normaliza/autoCorrige.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export async function ingerirFaturaEstruturada(pool, dados, { metodo = 'digital', origemCaptura = 'lidlplus' } = {}) {
  // 1) Reconciliação (valida soma vs total; não espalha desconto pelos itens).
  const rec = distribuirDesconto(dados.itens, {
    descontoGlobal: num(dados.desconto_global) || 0,
    totalImpresso: dados.total_impresso,
    iva: num(dados.iva) || 0,
  });
  const linhasInc = validarLinhas(dados.itens);
  const extracaoJson = {
    loja: dados.loja, data_compra: dados.data_compra, numero_fatura: dados.numero_fatura,
    total_impresso: dados.total_impresso, desconto_global: dados.desconto_global, iva: dados.iva, itens: dados.itens,
  };
  dados.itens = rec.itens;
  dados.iva = rec.iva;

  // 2) Camada 1: formato → preco_por_base (€/kg, €/L, €/un).
  for (const it of dados.itens) {
    if (it.is_non_product) { it.preco_por_base = null; continue; }
    const f = extrairFormato([it.descricao_original, it.linha_peso].filter(Boolean).join(' '));
    it.preco_por_base = precoPorBase({ preco_liquido: it.preco_liquido, quantidade: it.quantidade }, f);
  }

  // 3) Persistir (sem ficheiro — é digital), com deduplicação por cadeia+numero.
  const resultado = await persistirFatura(pool, dados, {
    ficheiroOriginal: null, metodo, origemCaptura,
    totalReconciliado: rec.totalReconciliado, discrepancia: rec.discrepancia,
    needsReview: !rec.extracaoBate || linhasInc.length > 0, extracaoJson,
  });
  if (resultado.duplicada) return { duplicada: true, fatura_id: resultado.fatura_id };
  const { fatura_id } = resultado;

  // 4) Normalização canónica + recompute ppb + auto-correção + merge — best-effort.
  await normalizarItensFatura(pool, fatura_id, { cadeia: dados.loja?.cadeia }).catch((e) => console.error('[estruturada] canonicalização:', e.message));
  await recomputarPpbFatura(pool, fatura_id).catch((e) => console.error('[estruturada] recompute ppb:', e.message));
  await autoCorrigirOutliers(pool, { aplicar: true }).catch((e) => console.error('[estruturada] auto-correção:', e.message));
  try {
    const [skuRows] = await pool.query('SELECT DISTINCT s.nome_canonico FROM item i JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.fatura_id = ?', [fatura_id]);
    await mergeNomesIdenticos(pool, new Set(skuRows.map((r) => r.nome_canonico)));
  } catch (e) { console.error('[estruturada] merge nomes:', e.message); }
  // 5) Enriquecer os EANs (das linhas) via OFF → ficha + nutrição. O prémio do Lidl.
  await enriquecerEansFatura(pool, fatura_id).catch((e) => console.error('[estruturada] enriquecer eans:', e.message));

  return { duplicada: false, fatura_id, n_itens: dados.itens.length, discrepancia: rec.discrepancia, reconcilia: rec.extracaoBate };
}

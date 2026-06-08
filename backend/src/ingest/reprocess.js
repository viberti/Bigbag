// Reprocessar uma nota JÁ guardada: re-corre a extração sobre o mesmo ficheiro
// (apanha melhorias de prompt/reconciliação retroativamente) e substitui os
// itens + atualiza os campos da fatura. A loja, o ficheiro e as revisões
// anteriores mantêm-se. ATENÇÃO: substitui os itens — edições manuais de
// quantidade nessa nota perdem-se (o operador está a re-ler de propósito). Os
// aliases (incl. manuais) são preservados: os itens novos re-resolvem pela cache.
import { readFile } from 'node:fs/promises';
import { extrairFatura, extrairFaturaDeTexto } from './extract.js';
import { eanValido } from './produto.js';
import { extrairTextoPdf } from './pdf.js';
import { preProcessarImagem } from './imagem.js';
import { distribuirDesconto, validarLinhas, pistaCirurgica } from './reconcile.js';
import { config } from '../config.js';
import { extrairFormato, precoPorBase } from '../normaliza/formato.js';
import { normalizarItensFatura, mergeNomesIdenticos, limparSkusOrfaos } from '../normaliza/matcher.js';
import { recomputarPpbFatura } from '../normaliza/ppb.js';
import { autoCorrigirOutliers } from '../normaliza/autoCorrige.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export async function reprocessarFatura(pool, faturaId) {
  const [[f]] = await pool.query(
    'SELECT f.ficheiro_original, f.metodo_extracao, l.cadeia FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.id = ?',
    [faturaId],
  );
  if (!f?.ficheiro_original) throw new Error('Nota sem ficheiro guardado');
  const buf = await readFile(f.ficheiro_original);
  const ehPdf = f.metodo_extracao === 'ocr_llm' || /\.pdf$/i.test(f.ficheiro_original);

  // Extração COM loop de auto-correção (igual à ingestão): re-alimenta a
  // discrepância do total E as inconsistências por linha, fica com o melhor.
  let reextrair;
  if (ehPdf) {
    const texto = await extrairTextoPdf(buf);
    reextrair = (correcao) => extrairFaturaDeTexto(texto, { correcao });
  } else {
    const img = await preProcessarImagem(buf);
    const imageBase64 = img.buffer.toString('base64');
    reextrair = (correcao) => extrairFatura({ imageBase64, mime: img.mime, correcao });
  }
  const reconciliar = (d) =>
    distribuirDesconto(d.itens, { descontoGlobal: num(d.desconto_global) || 0, totalImpresso: d.total_impresso, iva: num(d.iva) || 0 });
  const hintLinhas = (linhas) => {
    if (!linhas?.length) return '';
    const l = linhas[0];
    return ` ATENÇÃO À LINHA "${l.descricao}": ${l.quantidade} × ${l.preco_unitario} = ${l.esperado}, mas o "valor" lido foi ${l.valor} — corrige para ${l.esperado}.`;
  };
  const problemas = (r, linhas) => Math.abs(r.discrepancia) + (linhas?.length || 0);

  let dados = await reextrair();
  let rec = reconciliar(dados);
  let linhasInc = validarLinhas(dados.itens);
  for (let i = 0; i < config.openrouter.maxCorrecoes && (!rec.extracaoBate || linhasInc.length) && dados.total_impresso != null; i++) {
    const hint = `A soma dos itens deu ${rec.subtotal} mas o total impresso é ${dados.total_impresso} (diferença ${rec.discrepancia}). Reverifica: itens a peso, descontos/promoções, e itens em falta ou a mais.${pistaCirurgica(rec.itens, rec.discrepancia)}${hintLinhas(linhasInc)} Devolve o JSON corrigido.`;
    let d2, r2, li2;
    try {
      d2 = await reextrair(hint);
      r2 = reconciliar(d2);
      li2 = validarLinhas(d2.itens);
    } catch {
      break;
    }
    if (problemas(r2, li2) < problemas(rec, linhasInc)) {
      dados = d2;
      rec = r2;
      linhasInc = li2;
    } else break;
  }
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
      const eanItem = it.ean ? String(it.ean).replace(/\D/g, '') : null;
      await conn.query(
        `INSERT INTO item (fatura_id, sku_id, descricao_original, ean, linha_peso, quantidade, preco_unitario, preco_liquido,
           preco_por_base, taxa_iva, is_clearance, desconto_direto, is_non_product)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          faturaId,
          String(it.descricao_original || '').slice(0, 200),
          eanItem && eanValido(eanItem) ? eanItem : null,
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
    await conn.query(
      `UPDATE fatura SET total_impresso = ?, total_reconciliado = ?, discrepancia = ?, needs_review = ?,
         desconto_global = ?, precos_com_iva = ?, extracao_json = ? WHERE id = ?`,
      [
        num(dados.total_impresso),
        num(rec.totalReconciliado),
        num(rec.discrepancia),
        needsReview ? 1 : 0,
        num(dados.desconto_global) || 0,
        num(rec.iva) > 0 ? 0 : 1, // IVA somado EFETIVO (0 se espúrio) → precos_com_iva
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

  // Re-resolve os SKUs (com contexto da cadeia) e recomputa o preco_por_base
  // respeitando o unidade_base do SKU. Best-effort.
  await normalizarItensFatura(pool, faturaId, { cadeia: f.cadeia }).catch(() => {});
  // Funde SKUs de nome idêntico (como a ingestão) — senão re-canonicalizar pode
  // recriar duplicados (ex.: "Maçã Gala" com marca diferente).
  try {
    const [skuRows] = await pool.query(
      'SELECT DISTINCT s.nome_canonico FROM item i JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.fatura_id = ?',
      [faturaId],
    );
    await mergeNomesIdenticos(pool, new Set(skuRows.map((r) => r.nome_canonico)));
  } catch {
    /* noop */
  }
  await recomputarPpbFatura(pool, faturaId).catch(() => {});
  // Auto-correção de outliers (pack não capturado) — mesma passada da ingestão.
  await autoCorrigirOutliers(pool, { aplicar: true }).catch(() => {});
  // Limpa SKUs órfãos que o re-canonicalizar possa ter deixado (0 itens, sem
  // alias manual). Mantém a lista de produtos limpa sem tocar em curadoria.
  await limparSkusOrfaos(pool).catch(() => {});

  return { fatura_id: faturaId, n_itens: itens.length, needs_review: needsReview, discrepancia: rec.discrepancia };
}

// Pipeline de ingestão de UMA nota, reutilizável fora do request HTTP. Foi movido
// (intacto) do handler síncrono de POST /api/faturas para aqui, para o WORKER
// assíncrono (ingest/filaNotas.js) o poder correr em fundo sobre um ficheiro já
// guardado. Recebe o BUFFER da imagem/PDF + o caminho onde foi gravado; faz
// extração (VLM/PDF) com auto-correção → reconciliação → persistência → as camadas
// de normalização/verificação/lista. Devolve um RESUMO (não escreve no HTTP).
import { config } from '../config.js';
import { extrairFatura, extrairFaturaDeTexto } from './extract.js';
import { extrairTextoPdf } from './pdf.js';
import { preProcessarImagem } from './imagem.js';
import { distribuirDesconto, pistaCirurgica, validarLinhas } from './reconcile.js';
import { persistirFatura } from './persist.js';
import { extrairFormato, precoPorBase } from '../normaliza/formato.js';
import { normalizarItensFatura, mergeNomesIdenticos } from '../normaliza/matcher.js';
import { recomputarPpbFatura } from '../normaliza/ppb.js';
import { autoCorrigirOutliers } from '../normaliza/autoCorrige.js';
import { guardarMensagem } from '../historico.js';
import { enriquecerEansFatura } from './enriquecer.js';
import { reconciliarListaComFatura } from './reconciliarLista.js';
import { verificarNomesFatura } from './verificarNomes.js';
import { talaoSemValores, MSG_TALAO_SEM_VALORES } from './talaoValores.js';
import { dataCompraSuspeita } from '../normaliza/dia.js';

export async function processarNotaDeFicheiro(
  pool,
  { buffer, mime, originalname = null, ficheiroOriginal, origemCaptura = null, userId = null } = {},
) {
  const ehPdf = mime === 'application/pdf' || /\.pdf$/i.test(originalname || ficheiroOriginal || '');

  // 1) extração — PDF (texto+LLM) OU imagem (VLM), com loop de auto-correção
  let metodo;
  let reextrair;
  if (ehPdf) {
    const texto = await extrairTextoPdf(buffer);
    metodo = 'ocr_llm';
    reextrair = (correcao) => extrairFaturaDeTexto(texto, { correcao });
  } else {
    const img = await preProcessarImagem(buffer);
    const imageBase64 = img.buffer.toString('base64');
    metodo = 'vlm';
    reextrair = (correcao) => extrairFatura({ imageBase64, mime: img.mime, correcao });
  }
  const reconciliar = (d) =>
    distribuirDesconto(d.itens, {
      descontoGlobal: Number(d.desconto_global) || 0,
      totalImpresso: d.total_impresso,
      iva: Number(d.iva) || 0,
    });
  const hintLinhas = (linhas) => {
    if (!linhas?.length) return '';
    const l = linhas[0];
    return ` ATENÇÃO À LINHA "${l.descricao}": quantidade ${l.quantidade} × unitário ${l.preco_unitario} = ${l.esperado}, mas o "valor" lido foi ${l.valor}. O "valor" é o TOTAL da linha — corrige para ${l.esperado} (ou relê a quantidade/unitário).`;
  };
  const problemas = (r, linhas) => Math.abs(r.discrepancia) + (linhas?.length || 0);

  let dados = await reextrair();
  let rec = reconciliar(dados);
  let linhasInc = validarLinhas(dados.itens);

  for (let i = 0; i < config.openrouter.maxCorrecoes && (!rec.extracaoBate || linhasInc.length) && dados.total_impresso != null; i++) {
    const hint = `A soma dos itens deu ${rec.subtotal} mas o total impresso é ${dados.total_impresso} (diferença ${rec.discrepancia}). Reverifica com atenção: itens a peso (usa o PREÇO IMPRESSO na linha, não kg×€/kg), descontos/promoções, e itens em falta ou a mais.${pistaCirurgica(rec.itens, rec.discrepancia)}${hintLinhas(linhasInc)} Devolve o JSON corrigido.`;
    let dados2, rec2, linhasInc2;
    try {
      dados2 = await reextrair(hint);
      rec2 = reconciliar(dados2);
      linhasInc2 = validarLinhas(dados2.itens);
    } catch {
      break;
    }
    if (problemas(rec2, linhasInc2) < problemas(rec, linhasInc)) {
      dados = dados2;
      rec = rec2;
      linhasInc = linhasInc2;
    } else break;
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
  dados.itens = rec.itens;
  dados.iva = rec.iva;

  for (const it of dados.itens) {
    if (it.is_non_product) { it.preco_por_base = null; continue; }
    const f = extrairFormato([it.descricao_original, it.linha_peso].filter(Boolean).join(' '));
    it.preco_por_base = precoPorBase({ preco_liquido: it.preco_liquido, quantidade: it.quantidade }, f);
  }

  // Guard: talão SEM valores (resumo LidlPlus de cupões/pontos, cópia de reembolso ou foto
  // cortada) — não criar uma "compra" de 0 € (poluiria o histórico). Falha SEM retry (é
  // determinístico: repetir o VLP daria o mesmo) → o utilizador recebe o aviso e reenvia
  // o talão com os itens e preços.
  if (talaoSemValores(dados)) {
    const err = new Error(MSG_TALAO_SEM_VALORES);
    err.semRetry = true;
    throw err;
  }

  // 2) persistir (com deduplicação) — a imagem já foi gravada pelo chamador
  // Data implausível (ano/dia mal lido numa foto cortada) → NÃO aceitar em silêncio: a
  // compra ficaria arquivada no passado e sumia do histórico. Marca para revisão.
  const dataSusp = dataCompraSuspeita(dados.data_compra, new Date().toISOString().slice(0, 10), metodo);
  if (dataSusp) console.warn(`[nota] data suspeita: ${dados.data_compra} — ${dataSusp}`);
  const needsReview = !rec.extracaoBate || linhasInc.length > 0 || !!dataSusp;
  const resultado = await persistirFatura(pool, dados, {
    ficheiroOriginal,
    metodo,
    origemCaptura,
    modelo: ehPdf ? config.openrouter.model : config.openrouter.modelExtracao,
    totalReconciliado: rec.totalReconciliado,
    discrepancia: rec.discrepancia,
    needsReview,
    extracaoJson,
  });
  if (resultado.duplicada) {
    return {
      duplicada: true,
      fatura_id: resultado.fatura_id,
      loja: dados.loja,
      data_compra: dados.data_compra,
      total_impresso: dados.total_impresso,
      needs_review: false,
    };
  }
  const { fatura_id, loja_id, n_itens } = resultado;

  // 3) camadas pós-persistência (best-effort, idênticas à ingestão síncrona)
  await normalizarItensFatura(pool, fatura_id, { cadeia: dados.loja?.cadeia }).catch((e) =>
    console.error('[nota] canonicalização:', e.message));
  let verificacao = null;
  try {
    verificacao = await verificarNomesFatura(pool, fatura_id);
    if (verificacao?.corrigidos?.length)
      console.log(`[nota] nomes corrigidos: ${verificacao.corrigidos.map((c) => `"${c.de}"→"${c.para}"`).join(', ')}`);
  } catch (e) { console.error('[nota] verificar nomes:', e.message); }
  await recomputarPpbFatura(pool, fatura_id).catch((e) => console.error('[nota] recomputar ppb:', e.message));
  await autoCorrigirOutliers(pool, { aplicar: true }).catch((e) => console.error('[nota] auto-correção ppb:', e.message));
  try {
    const [skuRows] = await pool.query(
      'SELECT DISTINCT s.nome_canonico FROM item i JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.fatura_id = ?',
      [fatura_id]);
    await mergeNomesIdenticos(pool, new Set(skuRows.map((r) => r.nome_canonico)));
  } catch (e) { console.error('[nota] merge idênticos:', e.message); }
  await enriquecerEansFatura(pool, fatura_id).catch((e) => console.error('[nota] enriquecer eans:', e.message));
  let listaRec = null;
  try {
    listaRec = await reconciliarListaComFatura(pool, fatura_id);
    if (listaRec.comprados.length) console.log(`[nota] lista: saíram ${listaRec.comprados.length} (${listaRec.comprados.join(', ')})`);
  } catch (e) { console.error('[nota] reconciliar lista:', e.message); }

  // registo na conversa (contexto do assistente), só com utilizador conhecido
  if (userId) {
    const dataCurta = String(dados.data_compra || '').slice(0, 10);
    await guardarMensagem(
      userId, 'assistant',
      `📄 ${dados.loja?.cadeia || dados.loja?.nome}, ${dataCurta}, total ${Number(dados.total_impresso).toFixed(2).replace('.', ',')} €, ${n_itens} itens.${rec.extracaoBate ? '' : ' (em revisão — diferença a confirmar)'}`,
    ).catch(() => {});
  }

  return {
    duplicada: false,
    fatura_id,
    loja_id,
    metodo_extracao: metodo,
    loja: dados.loja,
    data_compra: dados.data_compra,
    total_impresso: dados.total_impresso,
    needs_review: needsReview,
    n_itens,
    lista_comprados: listaRec?.comprados || [],
    nomes_corrigidos: verificacao?.corrigidos || [],
  };
}

// A4 (Analise_Fontes §3.2) — extração DETERMINÍSTICA de marca do nome do talão,
// ANTES do LLM. Duas vias, por ordem de força:
//   1. MARCADOR de cadeia impresso no nome (CNT→Continente, PD→Pingo Doce, ARO→Aro):
//      o Continente imprime-o em 39% das descrições, o PD em 27% — determinístico puro.
//   2. GAZETTEER: ~3.500 marcas do catálogo + fichas; uma marca "bate" se TODOS os
//      seus tokens aparecem no nome E o token é DISTINTIVO (raridade IDF alta —
//      "Grainha"/"Pato"/"Fresco" são palavras de produto, não evidência de marca).
// Quem não bate em nada fica para o LLM (origem 'llm') ou "marca desconhecida" —
// valor válido e isolado (regra do Mestre §4.1).
import { carregarIdf } from './resolverProduto.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Marcadores de marca-própria/insígnia vistos nos talões reais.
export const MARCADORES_CADEIA = [
  [/\bCNT\b|\bCONTINENTE\b/i, 'Continente'],
  [/\bPINGO\s*DOCE\b|\bPD\b/i, 'Pingo Doce'],
  [/\bARO\b/i, 'Aro'],
  [/\bMYTHOS\b/i, 'Continente (Mythos)'],
  [/\bMILSANI\b/i, 'Milsani'],
  [/\bMILBONA\b/i, 'Milbona'],
  [/\bPILOS\b/i, 'Pilos'],
  [/\bCIEN\b/i, 'Cien'],
  [/\bW5\b/i, 'W5'],
  [/\bHACENDADO\b/i, 'Hacendado'],
  [/\bDELIPLUS\b/i, 'Deliplus'],
  [/\bMYLABEL\b/i, 'MyLabel'],
  [/\bAUCHAN\b/i, 'Auchan'],
];

// Palavras que existem como "marca" no catálogo mas são vocabulário de produto —
// nunca são evidência de marca num talão (medido: falsos positivos reais).
const BLOQUEADAS = new Set(['fresco', 'fresca', 'natural', 'integral', 'premium', 'pato', 'rainha', 'grainha', 'brasil', 'lisa', 'bio', 'gourmet', 'tradicional', 'caseiro', 'extra', 'fino', 'fina', 'real', 'nacional', 'original', 'classico', 'classica', 'seleccao', 'selecao']);

let _gaz = null;
// Gazetteer: marca normalizada → display. Cache por processo.
export async function carregarGazetteer(pool) {
  if (_gaz) return _gaz;
  const [rows] = await pool.query(`
    SELECT DISTINCT CONVERT(marca USING utf8mb4) COLLATE utf8mb4_unicode_ci AS marca
      FROM catalogo_produto WHERE marca IS NOT NULL AND marca <> ''
    UNION SELECT DISTINCT CONVERT(marca USING utf8mb4) COLLATE utf8mb4_unicode_ci
      FROM produto_ean WHERE marca IS NOT NULL AND marca <> ''`);
  _gaz = new Map();
  for (const { marca } of rows) {
    const k = norm(marca);
    if (k.length >= 4 && !_gaz.has(k)) _gaz.set(k, marca);
  }
  return _gaz;
}

// Núcleo PURO (testável): deteta a marca em `descricao` com o gazetteer dado.
// `idf` opcional pesa a distintividade dos tokens (sem ele, só comprimento+blocklist).
export function detetarMarca(descricao, gazetteer, idf = null) {
  const s = String(descricao || '');
  for (const [re, marca] of MARCADORES_CADEIA) {
    if (re.test(s)) return { marca, origem: 'marcador' };
  }
  const toksDesc = new Set(norm(s).split(' ').filter(Boolean));
  let melhor = null;
  for (const [k, display] of gazetteer) {
    const partes = k.split(' ');
    if (!partes.every((p) => toksDesc.has(p))) continue;
    // distintividade: nenhuma parte pode ser palavra comum de produto
    if (partes.some((p) => BLOQUEADAS.has(p))) continue;
    if (idf && partes.every((p) => (idf.w.get(p) ?? idf.max) < 4)) continue; // todas comuns nos nomes → fraco
    // a marca com MAIS tokens (mais específica) ganha; desempate: mais comprida
    if (!melhor || partes.length > melhor.partes || (partes.length === melhor.partes && k.length > melhor.k.length)) {
      melhor = { marca: display, partes: partes.length, k };
    }
  }
  return melhor ? { marca: melhor.marca, origem: 'gazetteer' } : null;
}

// Wrapper com BD (cacheado). Devolve { marca, origem } ou null.
export async function marcaDeterministica(pool, descricao) {
  const gaz = await carregarGazetteer(pool);
  let idf = null;
  try { idf = await carregarIdf(pool); } catch { /* sem catálogo → segue sem pesos */ }
  return detetarMarca(descricao, gaz, idf);
}

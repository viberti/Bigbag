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

import { normAlfa as norm } from './categoria.js'; // unificação 2026-06-13

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
const BLOQUEADAS = new Set(['fresco', 'fresca', 'natural', 'integral', 'premium', 'pato', 'rainha', 'grainha', 'brasil', 'lisa', 'bio', 'gourmet', 'tradicional', 'caseiro', 'extra', 'fino', 'fina', 'real', 'nacional', 'original', 'classico', 'classica', 'seleccao', 'selecao',
  // cores e descritores comuns que existem como "marca" no catálogo
  'branca', 'branco', 'preta', 'preto', 'negra', 'negro', 'verde', 'vermelha', 'vermelho', 'amarela', 'amarelo', 'doce', 'suave', 'forte', 'leve', 'grande',
  // estilos/variedades de produto (lácteos, dieta) apanhados como "marca" — ex.: "Iogurte Grego Oikos"
  // tinha "Grego" por marca (é estilo; a marca é Oikos). NÃO são marcas em PT/ES.
  'grego', 'grega', 'magro', 'magra', 'light', 'ligeiro', 'ligeira', 'desnatado', 'desnatada', 'semidesnatado', 'cremoso', 'cremosa', 'zero', 'biologico', 'biologica', 'batido',
  // variedade/origem apanhada como "marca" (app Lista 2026-10-16: "Tomate Cherry" → marca "Cherry";
  // "Queijo Gouda Holandês" → marca "Holandês"). Revisão: dono, 2026-10-16.
  'cherry', 'holandes', 'holandesa']);

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
    // marcas curtas REAIS ficavam fora do limiar >=4 (revisão 3.7b; evidência no
    // catálogo: W5 ×403, Bic, Cif, Axe, Uhu, Tuc, Ogx…). O matching é por TOKEN
    // exato (palavra inteira por natureza) → allowlist é segura.
    const curtaOk = MARCAS_CURTAS_OK.has(k);
    if ((k.length >= 4 || curtaOk) && !_gaz.has(k)) _gaz.set(k, marca);
  }
  return _gaz;
}

// Núcleo PURO (testável): deteta a marca em `descricao` com o gazetteer dado.
// `idf` opcional pesa a distintividade dos tokens (sem ele, só comprimento+blocklist).
const MARCAS_CURTAS_OK = new Set(['w5', 'w4', 'bic', 'cif', 'axe', 'uhu', 'tuc', 'ogx', 'xau']);

// Uma marca do gazetteer só é marca NESTE nome se a posição dela fizer sentido. O gazetteer
// vem do campo "marca" dos catálogos, onde muitas lojas (sobretudo VTEX BR) põem DESCRITORES
// ("Carne Bovina", "Forma", "Rolo", "De Laranja", "Pescada"). Casos reais da app Lista
// (2026-10-16): "carne picada bovina" → nome "picada" + marca "Carne Bovina"; "pão de forma"
// → "Pão de" + "Forma"; "rolo de cozinha" → "de cozinha" + "Rolo"; "chá" → marca "Chá Chá".
// Regras GERAIS (não por produto):
//  1. as palavras da marca aparecem SEGUIDAS e pela ordem (não espalhadas pelo nome);
//  2. a marca não é o nome inteiro (sobra pelo menos uma palavra que não é ligação);
//  3. a marca não começa/acaba numa ligação nem está COLADA a uma ("pão DE forma", "rolo DE
//     cozinha", "sumo DE laranja") — aí é o complemento do produto, não a marca.
const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'em', 'para', 'sem', 'a', 'o', 'ao', 'aos', 'na', 'no', 'y', 'con', 'del']);
export function marcaPlausivelNoNome(seq, partes) {
  if (LIGACOES.has(partes[0]) || LIGACOES.has(partes[partes.length - 1])) return false;
  let ini = -1;
  for (let i = 0; i + partes.length <= seq.length; i++) {
    if (partes.every((p, j) => seq[i + j] === p)) { ini = i; break; }
  }
  if (ini < 0) return false;                                                    // (1)
  const fim = ini + partes.length;                                              // exclusivo
  const resto = [...seq.slice(0, ini), ...seq.slice(fim)].filter((w) => !LIGACOES.has(w));
  if (!resto.length) return false;                                              // (2)
  if (LIGACOES.has(seq[ini - 1]) || LIGACOES.has(seq[fim])) return false;       // (3)
  return true;
}

export function detetarMarca(descricao, gazetteer, idf = null) {
  const s = String(descricao || '');
  for (const [re, marca] of MARCADORES_CADEIA) {
    if (re.test(s)) return { marca, origem: 'marcador' };
  }
  const seq = norm(s).split(' ').filter(Boolean);
  const toksDesc = new Set(seq);
  let melhor = null;
  for (const [k, display] of gazetteer) {
    const partes = k.split(' ');
    if (!partes.every((p) => toksDesc.has(p))) continue;
    if (!marcaPlausivelNoNome(seq, partes)) continue;
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
const _memoMarca = new Map(); // norm(descricao) → resultado (detetarMarca varre o
// gazetteer INTEIRO por chamada; a lista/despensa chamam-na por item, nomes que
// se repetem entre cargas/polls. Memo limitada por processo.)
export async function marcaDeterministica(pool, descricao) {
  const k = norm(descricao);
  if (_memoMarca.has(k)) return _memoMarca.get(k);
  const gaz = await carregarGazetteer(pool);
  let idf = null;
  try { idf = await carregarIdf(pool); } catch { /* sem catálogo → segue sem pesos */ }
  const r = detetarMarca(descricao, gaz, idf);
  if (_memoMarca.size > 5000) _memoMarca.clear();
  _memoMarca.set(k, r);
  return r;
}

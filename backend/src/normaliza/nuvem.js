// Nuvem de identidade por produto (TF-IDF leve) para AJUDAR a correspondência
// descrição→SKU nos casos ambíguos. Tudo TRANSIENTE: expande abreviaturas e tira
// stopwords/unidades NA HORA de casar — NÃO se armazena (o descricao_original fica
// fiel à nota; o nome expandido é derivado). Ver Paper §6 / Normalizacao.md.
import { ln } from './mestre.js';

// Palavras que NÃO contribuem para a identidade (ver análise da nuvem 2026-06-07).
// NÃO inclui palavras que colidem com produto (ex.: "doce" de Pingo Doce ≠ Doce de Leite).
const STOPWORDS = new Set([
  // conectores
  'de', 'do', 'da', 'dos', 'das', 'com', 'para', 'pra', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'ao', 'aos', 'a', 'o', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'ou', 'sem', 'ja', 'so',
  // unidades / medidas
  'kg', 'kgs', 'g', 'gr', 'grs', 'mg', 'ml', 'cl', 'l', 'lt', 'un', 'uni', 'unid', 'dz', 'cx',
  // marcadores de cadeia (sem colisão com produto)
  'cnt', 'pd', 'continente', 'lidl', 'aldi', 'makro', 'mercadona', 'pingo', 'auchan',
  // códigos de linha / embalagem
  'ls', 'ff', 'bi', 'emb', 'pack', 'cba',
]);

// Abreviaturas → forma canónica (expansão transiente). Alta confiança apenas.
// fat/fatias→fatiado e qj→queijo são CRÍTICOS (portões; ver caso gouda fatiado).
const EXPANSAO = new Map([
  ['qj', 'queijo'], ['qjo', 'queijo'],
  ['fat', 'fatiado'], ['fatias', 'fatiado'], ['fatiada', 'fatiado'], ['fatiadas', 'fatiado'], ['fatiados', 'fatiado'],
  ['ral', 'ralado'], ['ralada', 'ralado'],
  ['cz', 'cozido'], ['czdo', 'cozido'],
  ['desc', 'descafeinado'],
  ['iog', 'iogurte'], ['iogur', 'iogurte'],
  ['bol', 'bolacha'],
  ['choc', 'chocolate'],
  ['fum', 'fumado'],
  ['prep', 'preparado'], ['prepar', 'preparado'],
  ['gros', 'grosso'], ['univ', 'universal'], ['nat', 'natural'],
  ['req', 'requeijao'],
  ['mozz', 'mozzarella'], ['mozarela', 'mozzarella'], ['mozzarela', 'mozzarella'], ['mussarela', 'mozzarella'],
  ['gord', 'gordo'],
]);

const ehFormato = (t) => /^\d/.test(t); // começa por número → formato/peso

// Tokens de IDENTIDADE de uma descrição (expandidos, sem stopwords/unidades/códigos).
export function tokensIdentidade(txt) {
  return ln(txt)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => EXPANSAO.get(t) || t)
    .filter((t) => t.length > 1 && !ehFormato(t) && !STOPWORDS.has(t));
}

// Constrói a nuvem: assinatura de tokens por SKU + pesos IDF globais.
// docsPorSku: Map<skuId, string[]> (textos: nome canónico + descrições do SKU).
export function construirNuvem(docsPorSku) {
  const sig = new Map(); // skuId -> Set<token>
  const df = new Map(); // token -> nº de SKUs que o contêm
  for (const [sku, textos] of docsPorSku) {
    const toks = new Set(textos.flatMap(tokensIdentidade));
    sig.set(sku, toks);
    for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = sig.size;
  const idf = new Map([...df].map(([t, n]) => [t, Math.log((N + 1) / (n + 1)) + 1]));
  return { sig, idf, N };
}

// Pontua uma descrição contra cada SKU: Σ IDF dos tokens partilhados, normalizado
// pela "norma" da query (para não favorecer descrições longas). Devolve ordenado.
export function pontuar(txt, { sig, idf }) {
  const inToks = [...new Set(tokensIdentidade(txt))];
  const normQ = Math.sqrt(inToks.reduce((a, t) => a + (idf.get(t) || 0) ** 2, 0)) || 1;
  const out = [];
  for (const [sku, toks] of sig) {
    let s = 0;
    for (const t of inToks) if (toks.has(t)) s += idf.get(t) || 0;
    if (s > 0) out.push({ sku, score: s / normQ });
  }
  return out.sort((a, b) => b.score - a.score);
}

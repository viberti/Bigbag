// Camada 1 — expansão determinística de abreviaturas comuns nos talões PT.
// Barata e reversível (a descricao_original nunca se perde). Reduz o ruído
// ANTES do passo LLM/embeddings, e ajuda o match exato/fuzzy.
//
// Duas fontes (A3, Analise_Fontes §3.5):
//   - CURADAS (lista abaixo): casos confirmados em talões reais;
//   - MINADAS (abreviaturas_minadas.json, gerado por scripts/minar_abreviaturas.mjs):
//     aprendidas dos pares já validados (produto_nome, aprovações, aliases).
// Tokens da cadeia (CNT, PD, MERC...) são tratados por separarCadeia.
import { readFileSync } from 'node:fs';

// [etiqueta, regex (palavra inteira, case-insensitive), expansão]
const ABREV = [
  ['BOL', /\bBOL\b/gi, 'Bolacha'],
  ['BOLACH', /\bBOLACH\b/gi, 'Bolacha'],
  ['QJ', /\bQJ\b/gi, 'Queijo'],
  ['IOG', /\bIOG\b/gi, 'Iogurte'],
  ['MANT', /\bMANT\b/gi, 'Manteiga'],
  ['CEREA', /\bCEREA(IS|TS)\b/gi, 'Cereais'],
  ['LOMB', /\bLOMB\b/gi, 'Lombinhos'],
  ['FRANG', /\bFRANG\b/gi, 'Frango'],
  ['NAT', /\bNAT\b/gi, 'Natas'],
  ['CONSERVACAO', /\bCONSERVACA[OD]\b/gi, 'Conservação'],
  ['DESIDRAT', /\bDESIDRAT\b/gi, 'Desidratado'],
  ['SELECÇÃO', /\bSELECÇÃO\b/gi, 'Seleção'],
  ['C/', /\bC\/\s*/gi, 'com '],
  ['S/', /\bS\/\s*/gi, 'sem '],
  ['P/', /\bP\/\s*/gi, 'para '],
  ['EMB', /\bEMB\b/gi, 'Embalagem'],
  ['UN', /\bUN\b/gi, 'unidades'],
  // confirmadas nos talões reais (2026-06-10)
  ['FF', /\bFF\b/gi, 'Fatias Finas'],
  ['BRAS', /\bBRAS\b/gi, 'Braseado'],
  ['CHOC', /\bCHOC\b/gi, 'Chocolate'],
  ['CONG', /\bCONG\b/gi, 'Congelado'],
  ['INTEG', /\bINTEG\b/gi, 'Integral'],
  ['M/G', /\bM\/G\b/gi, 'Meio-Gordo'],
  ['DET', /\bDET\b/gi, 'Detergente'],
  ['CHAMP', /\bCHAMP\b/gi, 'Champô'],
  ['SAB', /\bSAB\b\.?/gi, 'Sabonete'],
  ['PAP', /\bPAP\b\.?/gi, 'Papel'],
  ['HIG', /\bHIG\b\.?/gi, 'Higiénico'],
];

// Minadas dos pares validados — formato { abrev: { expansao, suporte } }.
let MINADAS = {};
try {
  MINADAS = JSON.parse(readFileSync(new URL('./abreviaturas_minadas.json', import.meta.url), 'utf8'));
} catch { /* ainda não mineradas — só as curadas */ }
const etiquetasCuradas = new Set(ABREV.map(([l]) => l.toLowerCase()));

// Marca/cadeia embutida no fim da descrição (tokens a separar do nome).
const TOKENS_CADEIA = /\b(CNT|CONTINENTE|PD|PINGO DOCE|MERC|MERCADONA|LIDL|ALDI)\b/gi;

export function expandirAbreviaturas(desc) {
  let s = String(desc || '');
  for (const [, re, exp] of ABREV) s = s.replace(re, exp);
  for (const [ab, v] of Object.entries(MINADAS)) {
    if (etiquetasCuradas.has(ab)) continue; // curada ganha à minada
    s = s.replace(new RegExp(`\\b${ab}\\b`, 'gi'), v.expansao);
  }
  return s.replace(/\s+/g, ' ').trim();
}

// Abreviaturas do dicionário PRESENTES nesta descrição → [{abrev, expansao}].
// Para pistas DIRIGIDAS no prompt da canonicalização (só o que interessa ao caso).
export function expansoesPara(desc) {
  const s = String(desc || '');
  const out = [];
  for (const [label, re, exp] of ABREV) {
    if (new RegExp(re.source, 'i').test(s)) out.push({ abrev: label, expansao: exp.trim() });
  }
  for (const [ab, v] of Object.entries(MINADAS)) {
    if (etiquetasCuradas.has(ab)) continue;
    if (new RegExp(`\\b${ab}\\b`, 'i').test(s)) out.push({ abrev: ab.toUpperCase(), expansao: v.expansao });
  }
  return out;
}

// Remove o token da cadeia do nome e devolve-o à parte (palpite de marca própria).
export function separarCadeia(desc) {
  const s = String(desc || '');
  const m = s.match(TOKENS_CADEIA);
  const cadeia = m ? m[0].toUpperCase() : null;
  const semCadeia = s.replace(TOKENS_CADEIA, '').replace(/\s+/g, ' ').trim();
  return { semCadeia, cadeiaToken: cadeia };
}

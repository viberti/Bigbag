// Camada 1 — expansão determinística de abreviaturas comuns nos talões PT.
// Barata e reversível (a descricao_original nunca se perde). Reduz o ruído
// ANTES do passo LLM/embeddings, e ajuda o match exato/fuzzy.
//
// Tokens da cadeia (CNT, PD, MERC...) são removidos como marca por separado
// em marca.js (camada 2); aqui tratamos só de legibilidade do nome.

const ABREV = [
  // [regex (palavra inteira, case-insensitive), expansão]
  [/\bBOL\b/gi, 'Bolacha'],
  [/\bBOLACH\b/gi, 'Bolacha'],
  [/\bQJ\b/gi, 'Queijo'],
  [/\bIOG\b/gi, 'Iogurte'],
  [/\bMANT\b/gi, 'Manteiga'],
  [/\bCEREA(IS|TS)\b/gi, 'Cereais'],
  [/\bLOMB\b/gi, 'Lombinhos'],
  [/\bFRANG\b/gi, 'Frango'],
  [/\bNAT\b/gi, 'Natas'],
  [/\bCONSERVACA[OD]\b/gi, 'Conservação'],
  [/\bDESIDRAT\b/gi, 'Desidratado'],
  [/\bSELECÇÃO\b/gi, 'Seleção'],
  [/\bC\/\s*/gi, 'com '],
  [/\bS\/\s*/gi, 'sem '],
  [/\bP\/\s*/gi, 'para '],
  [/\bEMB\b/gi, 'Embalagem'],
  [/\bUN\b/gi, 'unidades'],
];

// Marca/cadeia embutida no fim da descrição (tokens a separar do nome).
const TOKENS_CADEIA = /\b(CNT|CONTINENTE|PD|PINGO DOCE|MERC|MERCADONA|LIDL|ALDI)\b/gi;

export function expandirAbreviaturas(desc) {
  let s = String(desc || '');
  for (const [re, exp] of ABREV) s = s.replace(re, exp);
  return s.replace(/\s+/g, ' ').trim();
}

// Remove o token da cadeia do nome e devolve-o à parte (palpite de marca própria).
export function separarCadeia(desc) {
  const s = String(desc || '');
  const m = s.match(TOKENS_CADEIA);
  const cadeia = m ? m[0].toUpperCase() : null;
  const semCadeia = s.replace(TOKENS_CADEIA, '').replace(/\s+/g, ' ').trim();
  return { semCadeia, cadeiaToken: cadeia };
}

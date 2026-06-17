// Matcher da TACO (Tabela Brasileira de Composição de Alimentos). Dá nutrição AUTORITATIVA
// de genéricos por NOME — usado em garantirGenericoSku para SUBSTITUIR a estimativa do LLM
// quando há um alimento TACO correspondente. Conservador: só devolve com match de confiança;
// senão null e o chamador fica com a estimativa do LLM (grátis, já calculada).
import { normAlfa, singularizar } from './categoria.js';
import { parseJsonCol } from '../db.js';

// palavras de LIGAÇÃO (não definem o alimento).
const STOP = new Set(['de', 'da', 'do', 'dos', 'das', 'com', 'sem', 'para', 'tipo', 'e', 'a', 'o', 'os', 'as', 'em', 'no', 'na', 'ao']);
// PREPARAÇÃO (modo de cozinhar) — não entra no match; "cru/natural" serve de preferência
// (forma-base = como o produto é vendido). NÃO inclui "pó" (isso é FORMA, ver abaixo).
const PREP = new Set(['cru', 'crua', 'crus', 'cruas', 'cozido', 'cozida', 'cozidos', 'cozidas', 'assado', 'assada', 'grelhado', 'grelhada', 'frito', 'frita', 'refogado', 'refogada', 'enlatado', 'enlatada', 'desidratado', 'seco', 'seca', 'natural', 'fresco', 'fresca']);
// FORMA do produto que MUDA a identidade (pó≠líquido, instantâneo≠massa, chips≠batata). Conta
// como qualificador: uma ficha com FORMA que o nome NÃO pediu é descartada (é outro produto).
const FORM = new Set(['po', 'instantaneo', 'chips']);

// tokens significativos (≥3 chars OU uma FORMA; sem stop/preparação, singularizados). Load + match.
export function tokensTaco(texto) {
  return [...new Set(normAlfa(texto).split(/\s+/)
    .map((t) => singularizar(t))
    .filter((t) => (t.length >= 3 || FORM.has(t)) && !STOP.has(t) && !PREP.has(t)))];
}

// Devolve { nutricao_100g, descricao, categoria } se houver alimento TACO de CONFIANÇA p/ o nome; senão null.
export async function nutricaoTaco(pool, nome) {
  const tq = tokensTaco(nome);
  if (!tq.length) return null;
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT descricao, categoria, nutricao, busca FROM nutricao_taco
        WHERE MATCH(busca) AGAINST(? IN BOOLEAN MODE) LIMIT 60`,
      [tq.map((t) => `${t}*`).join(' ')]);
  } catch { return null; }
  if (!rows?.length) return null;

  const headQ = tq[0];
  const tqSet = new Set(tq);
  // frequência dos QUALIFICADORES (tokens não pedidos) entre as fichas com a MESMA cabeça —
  // a variedade PROTOTÍPICA é a que recorre (ovo: galinha 5×, codorna 1×; batata: inglesa 4×, baroa 2×).
  const freq = new Map();
  for (const r of rows) {
    const arr = String(r.busca).split(' ');
    if (arr[0] !== headQ) continue;
    for (const t of arr) if (!tqSet.has(t)) freq.set(t, (freq.get(t) || 0) + 1);
  }
  let best = null; let bestScore = -Infinity;
  for (const r of rows) {
    const arr = String(r.busca).split(' ');
    const cobertura = tq.filter((t) => arr.includes(t)).length / tq.length;
    if (cobertura < 0.6) continue;
    // descarta a ficha com FORMA (pó/instantâneo/chips) que o nome não pediu — é outro produto.
    if (arr.some((t) => FORM.has(t) && !tqSet.has(t))) continue;
    const extra = arr.filter((t) => !tqSet.has(t));          // qualificadores que o nome não deu
    const headMatch = arr[0] === headQ ? 100 : 0;            // ficha LIDERADA pelo alimento do nome
    const proto = extra.reduce((s, t) => s + (freq.get(t) || 0), 0); // variedade prototípica
    const base = /\b(cru|crua|natural)\b/.test(normAlfa(r.descricao)) ? 0.5 : 0; // forma "como vendido"
    const score = headMatch + cobertura * 10 - extra.length * 2 + proto * 0.5 + base;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best ? { nutricao_100g: parseJsonCol(best.nutricao), descricao: best.descricao, categoria: best.categoria } : null;
}

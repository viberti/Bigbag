// Matcher da TACO (Tabela Brasileira de Composição de Alimentos). Dá nutrição AUTORITATIVA
// de genéricos por NOME — usado em garantirGenericoSku para substituir a estimativa do LLM
// quando há um alimento TACO correspondente. Conservador: exige cobertura forte dos tokens.
import { normAlfa, singularizar } from './categoria.js';
import { parseJsonCol } from '../db.js';

// palavras que NÃO definem o alimento (ligação) ou que são PREPARAÇÃO (não entram no match,
// mas "cru/crua" serve de preferência por ser a forma-base do produto comprado).
const STOP = new Set(['de', 'da', 'do', 'dos', 'das', 'com', 'sem', 'para', 'tipo', 'e', 'a', 'o', 'os', 'as', 'em', 'no', 'na', 'ao']);
const PREP = new Set(['cru', 'crua', 'crus', 'cruas', 'cozido', 'cozida', 'cozidos', 'cozidas', 'assado', 'assada', 'grelhado', 'grelhada', 'frito', 'frita', 'refogado', 'refogada', 'enlatado', 'enlatada', 'desidratado', 'seco', 'seca', 'natural', 'fresco', 'fresca', 'po', 'pó']);

// tokens significativos (≥3 chars, sem stop/preparação, singularizados). Usado no load e no match.
export function tokensTaco(texto) {
  return [...new Set(normAlfa(texto).split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !PREP.has(t))
    .map((t) => singularizar(t)))];
}

// Devolve { nutricao_100g, descricao, categoria } se houver alimento TACO que cubra o nome; senão null.
export async function nutricaoTaco(pool, nome) {
  const tq = tokensTaco(nome);
  if (!tq.length) return null;
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT descricao, categoria, nutricao, busca FROM nutricao_taco
        WHERE MATCH(busca) AGAINST(? IN BOOLEAN MODE) LIMIT 40`,
      [tq.map((t) => `${t}*`).join(' ')]);
  } catch { return null; }
  if (!rows?.length) return null;
  // ranking: a MAIORIA dos tokens do nome tem de estar na ficha (cobertura ≥0.6); + BOOST forte
  // se o alimento PRIMÁRIO da ficha (1.ª palavra) é a cabeça do nome — evita casar com um prato
  // que só CONTÉM o ingrediente ("Ovo" ≠ "Macarrão com ovos"; "Leite Integral" ≠ "Canjica com leite").
  const headQ = tq[0];
  let best = null; let bestScore = -1;
  for (const r of rows) {
    const teArr = String(r.busca).split(' ');
    const cobertura = tq.filter((t) => teArr.includes(t)).length / tq.length;
    if (cobertura < 0.6) continue;
    const headMatch = teArr[0] === headQ ? 1.0 : 0;       // ficha LIDERADA pelo alimento do nome
    const curta = -teArr.length * 0.04;                    // preferir a descrição mais genérica
    const score = cobertura + headMatch + curta;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best ? { nutricao_100g: parseJsonCol(best.nutricao), descricao: best.descricao, categoria: best.categoria } : null;
}

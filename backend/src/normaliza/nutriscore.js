// NUTRI-SCORE determinístico — algoritmo ATUALIZADO de 2023 (em vigor desde 31/12/2023, o que a
// França/Alemanha/Bélgica/Países Baixos/Suíça adotaram e o que o Open Food Facts já usa), para a
// categoria de ALIMENTOS SÓLIDOS GERAIS. A partir da nutrição por 100 g.
// Devolve { pontos, grau } — MENOR pontos = mais saudável (A). Pontos = negativos (energia, açúcar,
// gordura saturada, sal) MENOS positivos (fibra, proteína, %fruta).
//
// MUDANÇAS de 2023 face ao algoritmo original de 2017 (todas refletidas abaixo):
//   • Açúcar: escala 0..15 (era 0..10) — limiares mais finos, pune mais o açúcar alto.
//   • Sal: escala 0..20 (era 0..10) e usa o SAL diretamente (g), não o sódio (era sal×400).
//   • Proteína: 0..7 (era 0..5), limiares mais exigentes.
//   • Fibra: limiares mais exigentes (3,0..7,4 g; era 0,9..4,7).
//   • Cortes da letra (sólidos): A passou a ≤0 (era ≤−1).
//   Energia e gordura saturada (sólidos gerais): inalteradas.
//
// LIMITAÇÕES (assumidas de propósito):
//   1) NÃO temos a % de fruta/legumes/frutos secos (não parseamos ingredientes) → assume 0 → score um
//      pouco MAIS SEVERO que o oficial (produtos ricos em fruta perdem o bónus). Comparações entre
//      produtos mantêm-se justas (todos sem o bónus).
//   2) Só a escala de SÓLIDOS GERAIS. Bebidas (incl. leite/bebidas vegetais), gorduras/óleos/frutos
//      secos e queijos têm escalas próprias no Nutri-Score 2023 — a Nesquik PREPARADA como bebida, ou
//      sumos/refrigerantes, seriam pontuados pela escala de bebidas (com penalização de adoçantes),
//      mais severa. A acrescentar se valer.

const pts = (v, limites) => { for (let i = 0; i < limites.length; i++) if (v <= limites[i]) return i; return limites.length; };

// ── Tabelas oficiais 2023 — ALIMENTOS SÓLIDOS GERAIS (cada array = limites superiores; índice = pontos)
const L_ENERGIA  = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];                                  // kJ → 0..10 (inalterada)
const L_ACUCAR   = [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51];                              // g  → 0..15 (NOVA)
const L_SATURADA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];                                                             // g  → 0..10 (inalterada)
const L_SAL      = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0]; // g → 0..20 (NOVA, sal direto)
const L_FIBRA    = [3.0, 4.1, 5.2, 6.3, 7.4];                                                                   // g (AOAC) → 0..5 (limiares 2023)
const L_PROTEINA = [2.4, 4.8, 7.2, 9.6, 12, 14, 17];                                                            // g → 0..7 (NOVA)

// Nutrição esperada (por 100 g): { energia_kcal, acucares, gordura_saturada, sal, fibra, proteina }.
export function nutriScore(n) {
  if (!n || n.energia_kcal == null || n.gordura_saturada == null || n.acucares == null || n.sal == null) return null;
  const num = (x) => (x == null ? 0 : Number(x));
  const kJ = num(n.energia_kcal) * 4.184;
  // pontos NEGATIVOS (desfavoráveis): 0..55 no algoritmo de 2023
  const A = pts(kJ, L_ENERGIA) + pts(num(n.acucares), L_ACUCAR) + pts(num(n.gordura_saturada), L_SATURADA) + pts(num(n.sal), L_SAL);
  // pontos POSITIVOS (favoráveis)
  const ptFibra = n.fibra != null ? pts(num(n.fibra), L_FIBRA) : 0;            // 0..5
  const ptProt  = n.proteina != null ? pts(num(n.proteina), L_PROTEINA) : 0;  // 0..7
  const ptFruta = 0;                                                          // desconhecido (ver limitação 1)
  // regra oficial (mantida em 2023): se os negativos ≥ 11 e a fruta < 5, a PROTEÍNA não conta (só
  // fibra + fruta) — evita "compensar" um produto mau com proteína (ex.: carnes processadas).
  const pontos = (A >= 11 && ptFruta < 5) ? A - (ptFibra + ptFruta) : A - (ptFibra + ptProt + ptFruta);
  // cortes da letra para SÓLIDOS (2023): A ≤0, B ≤2, C ≤10, D ≤18, E ≥19
  const grau = pontos <= 0 ? 'A' : pontos <= 2 ? 'B' : pontos <= 10 ? 'C' : pontos <= 18 ? 'D' : 'E';
  return { pontos, grau };
}

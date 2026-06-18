// NUTRI-SCORE determinístico (algoritmo oficial 2017, alimentos GERAIS) a partir da nutrição por 100 g.
// Devolve { pontos, grau } — MENOR pontos = mais saudável (A). Pontos negativos (energia, açúcar, gordura
// saturada, sódio) MENOS pontos positivos (fibra, proteína, %fruta).
//
// LIMITAÇÕES (assumidas de propósito, p/ testar):
//   1) NÃO temos a % de fruta/legumes/frutos secos (não parseamos ingredientes) → assume 0 → score um
//      pouco MAIS SEVERO que o oficial (produtos ricos em fruta perdem o bónus). Comparações entre
//      produtos mantêm-se justas (todos sem o bónus).
//   2) Escala GERAL para tudo. Bebidas e gorduras/queijos têm escalas próprias no Nutri-Score — a
//      acrescentar se o teste valer (a Nesquik, p.ex., como BEBIDA seria pontuada mais severamente).
//   3) Sódio derivado do sal: sódio(mg) = sal(g) × 400.

const pts = (v, limites) => { for (let i = 0; i < limites.length; i++) if (v <= limites[i]) return i; return limites.length; };
const L_ENERGIA  = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350]; // kJ
const L_ACUCAR   = [4.5, 9, 13.5, 18, 22.5, 27, 31, 36, 40, 45];               // g
const L_SATURADA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];                            // g
const L_SODIO    = [90, 180, 270, 360, 450, 540, 630, 720, 810, 900];          // mg
const L_FIBRA    = [0.9, 1.9, 2.8, 3.7, 4.7];                                  // g (AOAC)
const L_PROTEINA = [1.6, 3.2, 4.8, 6.4, 8];                                    // g

// Nutrição esperada (por 100 g): { energia_kcal, acucares, gordura_saturada, sal, fibra, proteina }.
export function nutriScore(n) {
  if (!n || n.energia_kcal == null || n.gordura_saturada == null || n.acucares == null || n.sal == null) return null;
  const num = (x) => (x == null ? 0 : Number(x));
  const kJ = num(n.energia_kcal) * 4.184;
  const sodioMg = num(n.sal) * 400; // sal(g) → sódio(mg)
  const A = pts(kJ, L_ENERGIA) + pts(num(n.acucares), L_ACUCAR) + pts(num(n.gordura_saturada), L_SATURADA) + pts(sodioMg, L_SODIO); // 0..40
  const ptFibra = n.fibra != null ? pts(num(n.fibra), L_FIBRA) : 0;            // 0..5
  const ptProt  = n.proteina != null ? pts(num(n.proteina), L_PROTEINA) : 0;  // 0..5
  const ptFruta = 0;                                                          // desconhecido (ver limitação 1)
  // regra oficial: se A ≥ 11 e a fruta < 5, a PROTEÍNA não conta (só fibra + fruta) — evita "compensar"
  // um produto mau com proteína (ex.: carnes processadas).
  const pontos = (A >= 11 && ptFruta < 5) ? A - (ptFibra + ptFruta) : A - (ptFibra + ptProt + ptFruta);
  const grau = pontos <= -1 ? 'A' : pontos <= 2 ? 'B' : pontos <= 10 ? 'C' : pontos <= 18 ? 'D' : 'E';
  return { pontos, grau };
}

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
// DUAS escalas implementadas (Nutri-Score 2023):
//   • SÓLIDOS GERAIS (default).
//   • BEBIDAS (`classe='bebida'`) — tabelas próprias de energia/açúcar (bem mais severas), proteína
//     própria, e cortes de letra próprios; só a ÁGUA (`classe='agua'`) pode ser A. O LEITE conta como
//     bebida no Nutri-Score (apesar de estar em laticínios) — por isso a classe vem da FAMÍLIA, não do
//     grupo (ver `classeNutriScore` em familia.js).
//   • GORDURAS/ÓLEOS/FRUTOS SECOS (`classe='gordura'`) — energia a partir da SATURADA (não da energia
//     total) e saturada como RÁCIO saturada/gordura-total → o azeite deixa de ser injustamente E (fica
//     ~C); diferencia azeite (bom) de óleo de coco/manteiga (mau).
//
// LIMITAÇÕES (assumidas de propósito):
//   1) NÃO temos a % de fruta/legumes/frutos secos (não parseamos ingredientes) → assume 0 → score um
//      pouco MAIS SEVERO que o oficial (produtos ricos em fruta perdem o bónus). Comparações entre
//      produtos mantêm-se justas (todos sem o bónus).
//   2) NÃO detetamos adoçantes não-nutritivos → não aplicamos a penalização de +4 das bebidas (2023).
//   3) FALTA ainda a escala de QUEIJOS (a proteína conta sempre). A acrescentar se valer.

const pts = (v, limites) => { for (let i = 0; i < limites.length; i++) if (v <= limites[i]) return i; return limites.length; };

// ── Tabelas oficiais 2023 — ALIMENTOS SÓLIDOS GERAIS (cada array = limites superiores; índice = pontos)
const L_ENERGIA  = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];                                  // kJ → 0..10 (inalterada)
const L_ACUCAR   = [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51];                              // g  → 0..15 (NOVA)
const L_SATURADA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];                                                             // g  → 0..10 (inalterada)
const L_SAL      = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0]; // g → 0..20 (NOVA, sal direto)
const L_FIBRA    = [3.0, 4.1, 5.2, 6.3, 7.4];                                                                   // g (AOAC) → 0..5 (limiares 2023)
const L_PROTEINA = [2.4, 4.8, 7.2, 9.6, 12, 14, 17];                                                            // g → 0..7 (NOVA)

// ── Tabelas oficiais 2023 — BEBIDAS (por 100 ml; energia/açúcar muito mais severas que sólidos)
const L_ENERGIA_BEB  = [30, 90, 150, 210, 240, 270, 300, 330, 360, 390]; // kJ → 0..10
const L_ACUCAR_BEB   = [0.5, 2, 3.5, 5, 6, 7, 8, 9, 10, 11];             // g  → 0..10
const L_PROTEINA_BEB = [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0];             // g  → 0..7
// saturada e sal das bebidas usam as MESMAS tabelas dos sólidos (L_SATURADA, L_SAL).

// ── Tabelas oficiais 2023 — GORDURAS/ÓLEOS/FRUTOS SECOS (diferenciam azeite de óleo de coco):
// • a "energia" vem da ENERGIA DA SATURADA (saturada g × 37 kJ/g), não da energia total → não pune o
//   azeite só por ser calórico; pune a GORDURA MÁ.
// • a saturada entra como RÁCIO saturada/gordura-total (%) → azeite ~16% (bom), coco ~88% (mau).
// • açúcar e sal usam as tabelas gerais; proteína exclui-se quando os negativos ≥ 7.
const L_ENERGIA_SAT  = [120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200]; // kJ da saturada → 0..10
const L_SAT_RATIO    = [10, 16, 22, 28, 34, 40, 46, 52, 58, 64];             // % saturada/total → 0..10

// Nutrição esperada (por 100 g/ml): { energia_kcal, acucares, gordura_saturada, sal, fibra, proteina, gordura }.
// opts.classe: 'agua' (→ A) | 'bebida' (escala de bebidas) | 'gordura' (gorduras/óleos) | outro/undefined (sólidos).
export function nutriScore(n, opts = {}) {
  if (!n || n.energia_kcal == null || n.gordura_saturada == null || n.acucares == null || n.sal == null) return null;
  const num = (x) => (x == null ? 0 : Number(x));
  const bebida = opts.classe === 'bebida' || opts.classe === 'agua';
  const sat = num(n.gordura_saturada);
  const gorduraTotal = num(n.gordura);
  // GORDURAS/ÓLEOS só com a gordura total conhecida (precisa do rácio); senão cai p/ sólidos.
  const gordura = opts.classe === 'gordura' && gorduraTotal > 0;
  let A, ptProt;
  const ptFibra = n.fibra != null ? pts(num(n.fibra), L_FIBRA) : 0; // 0..5
  if (gordura) {
    // energia DA SATURADA (sat × 37 kJ/g) + rácio saturada/total + açúcar/sal gerais
    A = pts(sat * 37, L_ENERGIA_SAT) + pts((sat / gorduraTotal) * 100, L_SAT_RATIO)
      + pts(num(n.acucares), L_ACUCAR) + pts(num(n.sal), L_SAL);
    ptProt = n.proteina != null ? pts(num(n.proteina), L_PROTEINA) : 0;
  } else {
    const kJ = num(n.energia_kcal) * 4.184;
    A = pts(kJ, bebida ? L_ENERGIA_BEB : L_ENERGIA)
      + pts(num(n.acucares), bebida ? L_ACUCAR_BEB : L_ACUCAR)
      + pts(sat, L_SATURADA) + pts(num(n.sal), L_SAL);
    ptProt = n.proteina != null ? pts(num(n.proteina), bebida ? L_PROTEINA_BEB : L_PROTEINA) : 0; // 0..7
  }
  const ptFruta = 0; // desconhecido (ver limitação 1)
  // a PROTEÍNA não conta quando os negativos são altos (≥7 nas gorduras, ≥11 nos restantes) e a fruta<5
  // — evita "compensar" um produto mau com proteína.
  const capProt = gordura ? 7 : 11;
  const pontos = (A >= capProt && ptFruta < 5) ? A - (ptFibra + ptFruta) : A - (ptFibra + ptProt + ptFruta);
  let grau;
  if (opts.classe === 'agua') grau = 'A';                          // só a água pode ser A
  else if (bebida) grau = pontos <= 2 ? 'B' : pontos <= 6 ? 'C' : pontos <= 9 ? 'D' : 'E'; // bebidas: nunca A
  else if (gordura) grau = pontos <= -6 ? 'A' : pontos <= 2 ? 'B' : pontos <= 10 ? 'C' : pontos <= 18 ? 'D' : 'E'; // gorduras: A exige ≤−6
  else grau = pontos <= 0 ? 'A' : pontos <= 2 ? 'B' : pontos <= 10 ? 'C' : pontos <= 18 ? 'D' : 'E'; // sólidos
  return { pontos, grau };
}

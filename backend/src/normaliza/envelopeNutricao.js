// ENVELOPES NUTRICIONAIS POR FAMÍLIA (qualidade de dados camada C, 2026-06-30).
// O Atwater/plausibilidade (validadores.js) apanha o IMPOSSÍVEL; isto apanha o
// PLAUSÍVEL-MAS-ERRADO: um valor possível mas improvável PARA A FAMÍLIA (azeite com
// saturada=72 %, kcal coerente → passa em tudo, mas azeite é ~14 %).
//
// LIÇÃO DA 1.ª MEDIÇÃO (2026-06-30): muitas famílias misturam FORMAS (leite líquido vs
// em pó 484 kcal; batata fresca vs frita; sanduíches classificadas pelo peixe do recheio)
// → a distribuição é multimodal e o envelope ingénuo dava 30 % de falsos "suspeitos".
// Solução honesta: GATE DE HOMOGENEIDADE — só se constrói envelope onde a família é
// APERTADA (p95 perto da mediana). Onde não é, NÃO se sinaliza (a corroboração fica p/ a
// camada C1, cruzar fontes). Precisão > recall: preferimos não sinalizar a inundar de ruído.
//
// REGRA DURA: outlier de família = SUSPEITO (sinal p/ confiança/revisão), NÃO se apaga.

const NUTRIENTES = ['energia_kcal', 'gordura', 'gordura_saturada', 'acucares', 'hidratos', 'proteina', 'sal', 'fibra'];
// "ruído" por nutriente (g/100 g; kcal): desvios abaixo disto não interessam (evita o caso
// Néctar saturada=0,1 vs mediana 0 → 10σ falso). Também serve de piso da banda perto de zero.
const PISO = { energia_kcal: 20, gordura: 1.5, gordura_saturada: 1, acucares: 1.5, hidratos: 2, proteina: 1.5, sal: 0.2, fibra: 1 };
const MIN_AMOSTRAS = 40;   // p/ percentis estáveis
const RATIO_HOMOG = 2.5;   // família homogénea: p95 ≤ 2,5×mediana (e p05 ≥ mediana/3)
const RATIO_OUT = 1.8;     // outlier: valor > p95×1,8 (ou < p05/1,8) — bem além do já-extremo

function percentil(ordenado, q) {
  if (!ordenado.length) return null;
  const i = (ordenado.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? ordenado[lo] : ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (i - lo);
}

// Constrói envelopes de [{familia, n}]. Só nutriente×família com ≥MIN_AMOSTRAS E HOMOGÉNEOS.
// Devolve { [familia]: { [nutriente]: {p05, p50, p95, n} } }.
export function construirEnvelopes(amostras) {
  const porFam = new Map();
  for (const { familia, n } of amostras) {
    if (!familia || !n) continue;
    let f = porFam.get(familia); if (!f) { f = {}; porFam.set(familia, f); }
    for (const nut of NUTRIENTES) {
      const v = n[nut]; if (v == null || !Number.isFinite(Number(v))) continue;
      (f[nut] || (f[nut] = [])).push(Number(v));
    }
  }
  const env = {};
  for (const [familia, nuts] of porFam) {
    const e = {};
    for (const nut of NUTRIENTES) {
      const vals = nuts[nut]; if (!vals || vals.length < MIN_AMOSTRAS) continue;
      vals.sort((a, b) => a - b);
      const p05 = percentil(vals, 0.05), p50 = percentil(vals, 0.5), p95 = percentil(vals, 0.95);
      const piso = PISO[nut] || 1;
      // GATE de homogeneidade: a cauda tem de estar perto da mediana. Perto de zero, usa o piso.
      const homog = p50 > piso
        ? (p95 <= RATIO_HOMOG * p50 && p05 >= p50 / 3)
        : (p95 <= 2 * piso); // família "quase-zero" (ex.: açúcar no azeite) só vale se mesmo apertada
      if (!homog) continue;
      e[nut] = { p05: +p05.toFixed(2), p50: +p50.toFixed(2), p95: +p95.toFixed(2), n: vals.length };
    }
    if (Object.keys(e).length) env[familia] = e;
  }
  return env;
}

// Outliers grosseiros de uma nutrição vs o envelope da família. [] = dentro do esperado / sem envelope.
export function nutricaoSuspeita(n, familia, envelopes, { ratio = RATIO_OUT } = {}) {
  const e = envelopes && familia && envelopes[familia];
  if (!n || !e) return [];
  const out = [];
  for (const nut of NUTRIENTES) {
    const ref = e[nut]; const v = n[nut];
    if (!ref || v == null || !Number.isFinite(Number(v))) continue;
    const val = Number(v), piso = PISO[nut] || 1;
    if (Math.abs(val - ref.p50) <= piso) continue; // dentro do ruído → ignora
    const alto = val > Math.max(ref.p95 * ratio, ref.p50 + piso);
    const baixo = ref.p05 > piso && val < ref.p05 / ratio;
    if (alto || baixo) out.push({ nutriente: nut, valor: val, p50: ref.p50, p95: ref.p95, lado: alto ? 'alto' : 'baixo' });
  }
  return out;
}

export const _interno = { NUTRIENTES, PISO, MIN_AMOSTRAS, RATIO_HOMOG, RATIO_OUT, percentil };

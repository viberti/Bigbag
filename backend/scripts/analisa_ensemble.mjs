// Analisa os artefactos do head-to-head (_modelos_resultados.json) e calcula o
// TETO do ensemble: até onde uma combinação de modelos poderia chegar.
//  A) resumo por modelo (do artefacto)
//  B) oráculo best-of-N: ≥1 modelo reconcilia / lê total certo / acerta nº itens
//  C) consenso determinístico: alinha itens por similaridade entre modelos,
//     conta itens corroborados (≥2 modelos) vs BD, e os valores em DISCORDÂNCIA
//     (as linhas que um juiz teria de arbitrar).
import { readFile } from 'node:fs/promises';
import { similaridade } from '../src/normaliza/similaridade.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const med = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '?');

const out = JSON.parse(await readFile('scripts/_modelos_resultados.json', 'utf8'));
const MODELS = Object.keys(out);
const IDS = out[MODELS[0]].map((r) => r.id);

// A) resumo por modelo
console.log('================ A) POR MODELO ================');
console.log('modelo'.padEnd(34), 'recon', 'totOK', 'itens=BD', '|disc|', 'pesos', '$/rec', 'seg');
for (const m of MODELS) {
  const rows = out[m];
  const ok = rows.filter((r) => r.recon).length;
  const totok = rows.filter((r) => r.tot_ok).length;
  const imatch = rows.filter((r) => r.n === r.n_bd).length;
  const disc = rows.filter((r) => Number.isFinite(r.disc)).map((r) => Math.abs(r.disc));
  const pesos = rows.reduce((s, r) => s + (r.pesos || 0), 0);
  const cost = rows.reduce((s, r) => s + (r.cost || 0), 0) / rows.length;
  const seg = rows.reduce((s, r) => s + (r.ms || 0), 0) / rows.length / 1000;
  const errs = rows.filter((r) => r.erro).length;
  const dAvg = disc.length ? disc.reduce((a, b) => a + b, 0) / disc.length : NaN;
  console.log(m.padEnd(34), (ok + '/' + rows.length).padEnd(5), (totok + '/' + rows.length).padEnd(5), (imatch + '/' + rows.length).padEnd(8), f3(dAvg).padEnd(6), String(pesos).padEnd(5), f3(cost).padEnd(6), seg.toFixed(1) + (errs ? ' (' + errs + 'err)' : ''));
}

// B) oráculo best-of-N (teto de um SELETOR perfeito)
let boRec = 0, boTot = 0, boItens = 0;
for (const id of IDS) {
  const rs = MODELS.map((m) => out[m].find((r) => r.id === id)).filter(Boolean);
  if (rs.some((r) => r.recon)) boRec++;
  if (rs.some((r) => r.tot_ok)) boTot++;
  if (rs.some((r) => r.n === r.n_bd)) boItens++;
}
const N = IDS.length;
const bestReconSingle = Math.max(...MODELS.map((m) => out[m].filter((r) => r.recon).length));
console.log('\n================ B) ORÁCULO best-of-N (' + MODELS.length + ' modelos) ================');
console.log('≥1 modelo RECONCILIA:        ' + boRec + '/' + N + '   (melhor modelo isolado: ' + bestReconSingle + '/' + N + ')');
console.log('≥1 modelo lê TOTAL certo:    ' + boTot + '/' + N);
console.log('≥1 modelo acerta Nº ITENS:   ' + boItens + '/' + N);

// C) consenso determinístico (alinhar itens por similaridade)
console.log('\n================ C) CONSENSO determinístico ================');
let totCorrob = 0, totBD = 0, totDiscord = 0, totSoltos = 0;
for (const id of IDS) {
  const rs = MODELS.map((m) => ({ m, r: out[m].find((x) => x.id === id) })).filter((o) => o.r && !o.r.erro && o.r.itens);
  const n_bd = rs[0]?.r.n_bd ?? 0;
  const clusters = [];
  for (const { m, r } of rs) {
    for (const it of r.itens) {
      const c = { m, d: String(it.d || ''), v: num(it.v) };
      let best = null, bestS = 0;
      for (const cl of clusters) { const s = similaridade(c.d, cl.rep); if (s > bestS) { bestS = s; best = cl; } }
      if (best && bestS >= 0.55) { best.its.push(c); best.models.add(m); } else clusters.push({ rep: c.d, its: [c], models: new Set([m]) });
    }
  }
  const corrob = clusters.filter((cl) => cl.models.size >= 2);
  const soltos = clusters.filter((cl) => cl.models.size === 1).length; // só 1 modelo viu → suspeito (raro ou alucinação)
  const discord = corrob.filter((cl) => {
    const vs = cl.its.map((i) => i.v).filter(Number.isFinite);
    return vs.length >= 2 && Math.max(...vs) - Math.min(...vs) > 0.02;
  }).length;
  totCorrob += corrob.length; totBD += n_bd; totDiscord += discord; totSoltos += soltos;
  console.log('#' + id, '(BD ' + n_bd + ' itens):', 'corroborados=' + corrob.length, '| valores em discórdia=' + discord, '| vistos por 1 só=' + soltos);
}
console.log('\nTOTAIS: itens corroborados (≥2 modelos) ' + totCorrob + ' vs BD ' + totBD +
  '  | linhas a arbitrar (valor em discórdia) ' + totDiscord + '  | vistos por 1 só ' + totSoltos);
console.log('\nLeitura: best-of-N >> melhor isolado → modelos COMPLEMENTARES (juiz/seletor vale). ' +
  'discórdia baixa → consenso já resolve quase tudo sem LLM extra. (Caveat: clustering por descrição funde linhas repetidas do MESMO produto — subconta itens em recibos com 3× o mesmo produto, ex. #216.)');

// CORROBORAÇÃO de um match cross-loja por IMAGEM com METADADOS (PD/Lidl sem EAN →
// catálogo com EAN). A imagem dá o RECALL (candidatos); marca+peso+nome dão a
// PRECISION. Puro e testável — a política de bandas vive aqui (validada na
// calibração: AUTO ~90%+ correto; o gate de marca mata os lookalikes de marca
// diferente, ex.: Felix vs Purina, Dr.Oetker vs Ristorante).
import { normAlfa } from './categoria.js';

const nm = (s) => normAlfa(s || '');

// MARCA por TOKENS (não substring): "Garnier Ultra Suave" == "Ultra Suave Garnier".
// Partilham ≥1 token significativo → igual; ambas com tokens e zero comum → conflito.
export function marcaEstado(a, b) {
  const A = new Set(nm(a).split(' ').filter((t) => t.length >= 3));
  const B = new Set(nm(b).split(' ').filter((t) => t.length >= 3));
  if (!A.size || !B.size) return 'desc';
  for (const t of A) if (B.has(t)) return 'igual';
  return 'conflito';
}

// PESO normalizado (formato_valor + unidade_base): mesma unidade e valor a ≤6% →
// mesmo SKU; unidade ou valor diferentes → difere (mesmo produto, outro tamanho).
export function pesoEstado(pf, pu, cf, cu) {
  if (pf == null || cf == null || !pu || !cu) return 'desc';
  if (nm(pu) !== nm(cu)) return 'difere';
  const a = Number(pf), b = Number(cf);
  if (!(a > 0) || !(b > 0)) return 'desc';
  return Math.abs(a - b) / Math.max(a, b) <= 0.06 ? 'igual' : 'difere';
}

// Overlap de NOME por tokens distintivos (≥4 chars) — sinal fraco de apoio.
export function nomeOverlap(a, b) {
  const toks = (s) => new Set(nm(s).split(' ').filter((t) => t.length >= 4));
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

// Entre os top-k candidatos da imagem, escolhe o MELHOR CORROBORADO (marca>peso>visual).
// `pd` = {nome, marca, fval, ubase}; `cands` = [{id, ean, score, fonte}]; metaById: id→{nome,marca,fval,ubase,fonte}.
export function melhorCandidato(pd, cands, metaById) {
  let best = null;
  for (const c of cands || []) {
    const m = metaById.get(c.id); if (!m) continue;
    const marca = marcaEstado(pd.marca, m.marca);
    const peso = pesoEstado(pd.fval, pd.ubase, m.fval, m.ubase);
    const ov = nomeOverlap(pd.nome, m.nome);
    const rank = (marca === 'igual' ? 2 : marca === 'desc' ? 1 : 0) * 10 + (peso === 'igual' ? 2 : peso === 'desc' ? 1 : 0) * 3 + c.score;
    if (!best || rank > best.rank) best = { cand: c, m, marca, peso, ov, score: c.score, rank };
  }
  return best;
}

// BANDA de decisão a partir do melhor candidato corroborado.
//  auto          marca igual + peso igual + visual≥0.72  → mesmo SKU (alta confiança)
//  outro_tamanho marca igual + peso difere + visual≥0.72 → mesmo produto, outro tamanho (€/kg)
//  revisao       marca não-conflito + visual≥0.85 + nome≥0.5 → humano decide
//  rejeitado     conflito de marca + visual≥0.80 → falso positivo visual (não liga)
//  sem_match     nada fiável
export function decidirBanda(b) {
  if (!b) return 'sem_match';
  if (b.marca === 'conflito' && b.score >= 0.80) return 'rejeitado';
  if (b.marca === 'igual' && b.peso === 'igual' && b.score >= 0.72) return 'auto';
  if (b.marca === 'igual' && b.peso === 'difere' && b.score >= 0.72) return 'outro_tamanho';
  if (b.marca !== 'conflito' && b.score >= 0.85 && b.ov >= 0.5) return 'revisao';
  return 'sem_match';
}

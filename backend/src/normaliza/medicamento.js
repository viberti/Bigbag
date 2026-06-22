// Normalização de medicamentos (Brasil) — PURO e testável (gate do deploy).
// A lista CMED traz a "apresentação" num formato denso e abreviado, ex.:
//   "500 MG COM REV CT BL AL PLAS INC X 30"
//   "50 MG/ML SOL OR CT FR PLAS OPC GOT X 20 ML"
//   "500 MG + 200 MG COM REV CT BL AL PLAS INC X 30"
// Daqui extraímos a TRÍADE que define equivalência terapêutica e a base da
// comparação de preço: DOSAGEM (princípio ativo + força), FORMA farmacêutica e
// QUANTIDADE na embalagem. Com a quantidade calculamos o "preço por dose"
// (R$/comprimido, R$/ml) — o equivalente, nos remédios, do preco_por_base.

// Abreviaturas de FORMA farmacêutica → forma canónica (PT-BR). Ordem importa só
// para a leitura humana; o match é por token exato.
const FORMAS = {
  COM: 'comprimido', CPR: 'comprimido', DRG: 'drágea', CAP: 'cápsula', CAPS: 'cápsula',
  SOL: 'solução', SUS: 'suspensão', SUSP: 'suspensão', XPE: 'xarope', XAR: 'xarope',
  EMU: 'emulsão', EMUL: 'emulsão', CREM: 'creme', CR: 'creme', POM: 'pomada', GEL: 'gel',
  LOC: 'loção', PO: 'pó', GRAN: 'granulado', SUP: 'supositório', OVU: 'óvulo',
  AER: 'aerossol', AERO: 'aerossol', SPRAY: 'spray', GTS: 'gotas', GOT: 'gotas',
  ADES: 'adesivo', PAST: 'pastilha', ENV: 'envelope', SCH: 'sachê', SACHE: 'sachê',
  INJ: 'injetável', LIOF: 'liofilizado', ELI: 'elixir', SHA: 'xampu', ESM: 'esmalte',
  COL: 'colírio', PAS: 'pasta', FILM: 'filme', IMPL: 'implante', VER: 'verniz',
};

// Unidades de força reconhecidas (a 1.ª que aparecer define dose_valor/dose_unidade).
const RE_DOSE = /(\d+(?:[.,]\d+)?)\s*(MCG|MG\/ML|MG\/G|MG\/DOSE|UI\/ML|MG|UI|G\/ML|G|%|ML)\b/;

const num = (s) => {
  if (s == null) return null;
  const v = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// Parseia a apresentação CMED. Tolerante: devolve null nos campos que não der.
export function parseApresentacao(apresentacao) {
  const out = { dosagem: null, dose_valor: null, dose_unidade: null, forma: null, qtd_embalagem: null };
  const s = String(apresentacao || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!s) return out;
  const toks = s.split(' ');

  // 1) FORMA: o primeiro token que seja uma abreviatura de forma conhecida.
  let formaIdx = -1;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].replace(/[^A-Z/]/g, '');
    if (FORMAS[t]) { out.forma = FORMAS[t]; formaIdx = i; break; }
  }

  // 2) DOSAGEM: tudo ANTES da forma (capta combinações "500 MG + 200 MG").
  const parteDose = (formaIdx > 0 ? toks.slice(0, formaIdx) : toks).join(' ');
  const mDose = parteDose.match(RE_DOSE) || s.match(RE_DOSE);
  if (mDose) {
    out.dose_valor = num(mDose[1]);
    out.dose_unidade = mDose[2];
    // dosagem = string até ao fim da última força na parte da dose (preserva combos)
    out.dosagem = (formaIdx > 0 ? parteDose : mDose[0]).replace(/\s+/g, ' ').trim() || mDose[0];
  }

  // 3) QUANTIDADE na embalagem: número após o ÚLTIMO "X". Multiplica por um
  //    contador de blisters/frascos se a embalagem o indicar ("CT 2 BL ... X 14" = 28).
  const xs = [...s.matchAll(/\bX\s*(\d+)\b/g)];
  if (xs.length) {
    const ultimo = Number(xs[xs.length - 1][1]);
    const mMult = s.match(/\b(\d+)\s+(?:BL|FR|FA|AMP|SER|CAR|ENV|BG|TB)\b/); // ex.: "2 BL"
    const mult = mMult ? Number(mMult[1]) : 1;
    out.qtd_embalagem = Number.isFinite(ultimo) ? ultimo * (mult > 1 ? mult : 1) : null;
  }
  return out;
}

// tipo CMED → é genérico? (o "Tipo de Produto" da CMED traz "Genérico", "Similar",
// "Novo", "Específico", "Biológico", "Fitoterápico", "Radiofármaco"…)
export function ehGenerico(tipo) {
  return /gen[eé]ric/i.test(String(tipo || ''));
}

// Preço por dose (R$ por comprimido/cápsula/ml) — base da comparação justa entre
// embalagens de tamanhos diferentes. null se não houver quantidade fiável.
export function precoPorDose(preco, qtd) {
  if (preco == null || qtd == null) return null; // Number(null)===0 (finito) → guardar antes
  const p = Number(preco), q = Number(qtd);
  if (!Number.isFinite(p) || !Number.isFinite(q) || q <= 0) return null;
  return Math.round((p / q) * 10000) / 10000;
}

// Chave de equivalência terapêutica: mesmo princípio ativo + força + forma.
// Usada para agrupar genérico/referência/similar do MESMO remédio.
export function chaveEquivalencia({ substancia, dose_valor, dose_unidade, forma }) {
  return [
    String(substancia || '').toUpperCase().replace(/\s+/g, ' ').trim(),
    dose_valor ?? '', dose_unidade || '', forma || '',
  ].join('|');
}

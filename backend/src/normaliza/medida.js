// Interpreta uma MEDIDA (peso/volume) escrita/ditada no nome de um item da lista:
//   "2 kg batata" · "300g fiambre" · "1 litro de leite" · "meio quilo de café" · "1,5 L" · "500 ml natas"
// → { nome: <sem a medida>, qtd_medida, unidade }   (unidade ∈ 'kg'|'g'|'L'|'ml')
// Sem medida → null (= contagem simples, o comportamento de sempre).
// USER-DRIVEN por desenho: a unidade vem do que o utilizador MANDOU — nada de adivinhar pela
// categoria/grupo (banana é à unidade, uvas a peso: o grupo é grosso demais; quem decide é o pedido).
// Módulo PURO (sem BD/LLM), testável; partilhável front/back.

const U = {
  kg: 'kg', kgs: 'kg', quilo: 'kg', quilos: 'kg', quilograma: 'kg', quilogramas: 'kg', kilo: 'kg', kilos: 'kg',
  g: 'g', gr: 'g', grama: 'g', gramas: 'g',
  l: 'L', lt: 'L', litro: 'L', litros: 'L', mililitro: 'ml', mililitros: 'ml', ml: 'ml', cl: 'cl',
};
// número (1, 2,5, 1.5) OU "meio/meia", seguido (opcional espaço) da unidade como PALAVRA inteira.
const RE = new RegExp(`(?:^|\\b)(\\d+(?:[.,]\\d+)?|mei[ao])\\s*(${Object.keys(U).join('|')})\\b`, 'i');

export function interpretarMedida(nomeOriginal) {
  const nome = String(nomeOriginal || '').trim();
  if (!nome) return null;
  const m = nome.match(RE);
  if (!m) return null;
  let qtd = /^mei[ao]$/i.test(m[1]) ? 0.5 : Number(String(m[1]).replace(',', '.'));
  if (!Number.isFinite(qtd) || qtd <= 0) return null;
  let unidade = U[m[2].toLowerCase()];
  if (unidade === 'cl') { unidade = 'ml'; qtd *= 10; } // cl → ml (eixo único de volume sub-L)
  // limpar o nome: tira a medida e um "de" de ligação à cabeça ("2 kg de batata" → "batata";
  // NÃO toca num "de" no meio: "1 kg doce de leite" → "doce de leite").
  let limpo = nome.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
  limpo = limpo.replace(/^de\s+/i, '').replace(/^[-·,]+|[-·,]+$/g, '').trim();
  if (limpo.length < 2) return null; // "2 kg" sem produto → não é um item de medida útil
  return { nome: limpo, qtd_medida: Math.round(qtd * 1000) / 1000, unidade };
}

// Rótulo legível de uma medida: 0.3 'kg' → "300 g" (sub-1kg em g), 1.5 'L' → "1,5 L", 2 'kg' → "2 kg".
export function rotuloMedida(qtd, unidade) {
  const n = Number(qtd) || 0;
  const fmt = (x) => (Number.isInteger(x) ? String(x) : String(x).replace('.', ','));
  if (unidade === 'kg') return n < 1 ? `${Math.round(n * 1000)} g` : `${fmt(Math.round(n * 1000) / 1000)} kg`;
  if (unidade === 'g') return n >= 1000 ? `${fmt(Math.round(n) / 1000)} kg` : `${Math.round(n)} g`;
  if (unidade === 'L') return n < 1 ? `${Math.round(n * 1000)} ml` : `${fmt(Math.round(n * 1000) / 1000)} L`;
  if (unidade === 'ml') return n >= 1000 ? `${fmt(Math.round(n) / 1000)} L` : `${Math.round(n)} ml`;
  return `${fmt(n)} ${unidade || ''}`.trim();
}

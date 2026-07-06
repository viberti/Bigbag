// Data-CALENDÁRIO (o DIA de algo: compra, validade) — utilitários puros, partilhados
// front/back. Uma data-calendário NÃO é um instante: não tem hora nem fuso. O bug a evitar
// (2026-07-03): a data da compra em Portugal (1-jul) recuava para 30-jun ao ser vista no
// Brasil (UTC−3), porque passava por um `Date` com fuso (dupla conversão servidor+cliente).
//
// REGRA: nunca fazer `new Date(dataDaApi)` sobre uma data-calendário. O backend devolve-a
// como string 'YYYY-MM-DD' (coluna DATE + dateStrings, ou DATE_FORMAT); aqui reconstrói-se
// como Date LOCAL nesse dia — o mesmo dia em QUALQUER fuso.

// String ('YYYY-MM-DD', ISO, ou 'YYYY-MM-DD HH:MM:SS') → Date LOCAL à meia-noite desse dia,
// ou null. Toma sempre a parte de DATA; ignora hora e fuso.
export function parseDia(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

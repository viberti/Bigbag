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

const DIA_MS = 86400000;

// A data lida é PLAUSÍVEL face ao momento da captura? Caso real (2026-08-07): a linha da
// data estava CORTADA na foto e o VLM devolveu 2023-08-07 em vez de 2026 — a compra foi
// arquivada 3 anos atrás, sumiu do topo do histórico e o utilizador julgou-a "não lida".
// O guard antigo (ano entre 2010 e agora+1) não apanhava isto. Devolve o MOTIVO (string) ou
// null se está tudo bem — para expor a suspeita em vez de aceitar em silêncio.
//   metodo 'vlm'  = foto de talão em papel → é recente por natureza (dias, não anos).
//   metodo 'ocr_llm' = PDF/fatura eletrónica → importar arquivo ANTIGO é normal, não sinaliza.
export function dataCompraSuspeita(dataCompra, dataCaptura, metodo = 'vlm', maxDias = 60) {
  const d = parseDia(dataCompra);
  const cap = parseDia(dataCaptura);
  if (!d || !cap) return null;
  const dias = Math.round((cap - d) / DIA_MS);
  if (dias < -1) return `data no FUTURO (${-dias} dias depois da captura)`;
  if (metodo === 'vlm' && dias > maxDias) return `data ${dias} dias antes da captura (ano/data mal lido?)`;
  return null;
}

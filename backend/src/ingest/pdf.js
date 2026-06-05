// Extrai texto de um PDF (faturas digitais, ex. Fatura Cartão Continente).
// Usa unpdf (pdf.js empacotado para Node/serverless, sem dependências nativas).
import { extractText, getDocumentProxy } from 'unpdf';

export async function extrairTextoPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || '').trim();
}

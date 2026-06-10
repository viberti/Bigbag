// Conteúdo da embalagem de um produto (por EAN), parseado do texto livre
// `quantidade` da ficha ("1 kg", "4x125g", "45 Unidades"). Um EAN implica
// embalagem fixa — o conteúdo é propriedade do PRODUTO e permite derivar
// €/kg|L|un mesmo quando a linha do talão não traz peso (Analise_Fontes §3.1).
import { extrairFormato } from './formato.js';

// Devolve { valor, unidade ('kg'|'L'|'un'), pack } ou null quando o texto não
// declara conteúdo. O fallback {un, 1} do extrairFormato NÃO conta — só padrões
// explícitos (senão "n/d" viraria "1 unidade").
export function conteudoDeTexto(texto) {
  let s = String(texto || '').trim();
  if (!s) return null;
  s = s.replace(/\b(\d+)\s*(unidades?|unid)\b/gi, '$1un'); // "45 Unidades" → "45un"
  const explicito = /\d\s*(kgs|kg|grs|gr|g|ml|cl|lt|l|un|dz)\b/i.test(s) || /d[uú]zia|\bovos?\b/i.test(s);
  if (!explicito) return null;
  const f = extrairFormato(s);
  if (!f || f.formato_valor == null || !(f.formato_valor > 0)) return null;
  const mPack = s.match(/(\d+)\s*[x×X*]\s*\d+(?:[.,]\d+)?\s*(?:kgs|kg|k|grs|gr|g|ml|cl|lt|l)\b/i);
  return { valor: f.formato_valor, unidade: f.unidade_base, pack: mPack ? Number(mPack[1]) : null };
}

// Reparseia o `quantidade` da ficha e grava as colunas estruturadas. Idempotente;
// chama-se depois de cada escrita de ficha (e no backfill).
export async function atualizarConteudoFicha(db, ean) {
  if (!ean) return;
  const [[r]] = await db.query('SELECT quantidade FROM produto_ean WHERE ean = ?', [ean]);
  if (!r) return;
  const c = conteudoDeTexto(r.quantidade);
  await db.query('UPDATE produto_ean SET conteudo_valor = ?, conteudo_unidade = ?, conteudo_pack = ? WHERE ean = ?', [
    c?.valor ?? null,
    c?.unidade ?? null,
    c?.pack ?? null,
    ean,
  ]);
}

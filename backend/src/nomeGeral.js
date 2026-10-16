// FORMA GERAL de um nome de produto para SUGERIR numa lista (dono, 2026-10-16): numa lista
// escreve-se "café descafeinado" ou "ovos frescos", não "Café Descafeinado Nestlé 250g" nem
// "24 OVOS Frescos". Fonte ÚNICA para o autocomplete (nomes que a casa já escreveu — muitos
// entraram por código de barras com o nome completo do produto), os chips "talvez precise de"
// e os genéricos do índice de pesquisa (construir_produto_busca).
import { marcaDeterministica } from './normaliza/marca.js';
import { marcaEhTipo, nomeSemMarca } from './normaliza/categoria.js';

// Parte PURA (testável): tira quantidades/tamanhos e normaliza MAIÚSCULAS de talão/etiqueta.
const RE_TAMANHO = /\b\d+([.,]\d+)?\s*(x\s*\d+([.,]\d+)?\s*)?(kg|g|gr|grs|mg|ml|cl|dl|l|lt|lts|un|uni|unid|unidades|saquetas?|cápsulas?|capsulas?|doses?)\b\.?/gi;
const RE_MULTI = /\b\d+\s*x\s*\d*\b/gi;       // "6x", "4 x 125" (o resto do tamanho já saiu)
const RE_CONTAGEM_INICIO = /^\s*\d+\s+/;        // "24 OVOS Frescos" → "OVOS Frescos"
export function limparFormaGeral(nome) {
  let s = String(nome || '');
  s = s.replace(RE_TAMANHO, ' ').replace(RE_MULTI, ' ').replace(RE_CONTAGEM_INICIO, '');
  s = s.replace(/\s*[-–·,]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  // palavra TODA em maiúsculas (talão/etiqueta) → "Ovos"; siglas até 3 letras ficam (UHT, IGP, BIO)
  s = s.split(' ').map((w) => (w.length > 3 && w === w.toUpperCase() && /[A-ZÀ-Ý]/.test(w)
    ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Forma geral completa: tira a MARCA quando o detetor a reconhece com posição plausível e não é
// um TIPO (ver marcaPlausivelNoNome), depois limpa tamanhos/maiúsculas. Nunca devolve vazio.
export async function formaGeral(pool, nome) {
  const md = (await marcaDeterministica(pool, nome).catch(() => null))?.marca || null;
  const semMarca = md && !marcaEhTipo(md) ? nomeSemMarca(nome, md) : nome;
  return limparFormaGeral(semMarca) || limparFormaGeral(nome) || String(nome || '');
}

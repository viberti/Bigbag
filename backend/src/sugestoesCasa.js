// Autocomplete da LISTA: os nomes que a CASA já escreveu primeiro (dono, 2026-10-16: "o nome dos
// itens dados na lista tem grande chance de serem repetidos em listas futuras"). É o vocabulário
// próprio da casa ("Pao shape", "Carne picada bovina") — vale mais do que o genérico do catálogo.
// Puro (testável): recebe as linhas já lidas da BD.
import { chaveItemLista } from './normaliza/categoria.js';

// casa: [{ nome, dias, ultima }] já ordenado por relevância; catalogo: linhas do produto_busca.
export function juntarSugestoes(casa, catalogo, limite = 8, maxCasa = 4) {
  const vistos = new Set();
  const out = [];
  for (const c of casa.slice(0, maxCasa)) {
    const k = chaveItemLista(c.nome);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push({ generico: true, casa: true, nome: c.nome, marca: null, tamanho: null, ean: null, tem_nutricao: false, vezes: c.dias || 1 });
  }
  for (const r of catalogo) {
    if (out.length >= limite) break;
    const k = chaveItemLista(r.nome);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(r);
  }
  return out.slice(0, limite);
}

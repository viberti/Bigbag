// Reconciliação da LISTA DE COMPRAS partilhada com um talão ingerido: os itens
// da lista que aparecem na compra saem sozinhos (estado 'comprado', ligados à
// fatura); os restantes ficam para a próxima ida. Matching DETERMINÍSTICO (sem
// LLM): todos os tokens significativos do nome da lista têm de aparecer no nome
// do produto comprado (canónico, simplificado ou descrição do talão), com
// tolerância a acentos (PT-BR "higiênico" ↔ PT "higiénico") e singular/plural
// ("Bananas" casa "Banana"). Conservador: token a mais na lista → NÃO casa.
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para', 'em', 'a', 'o', 'os', 'as', 'un', 'kg', 'g', 'ml', 'l', 'cl']);
import { normAlfa as norm } from '../normaliza/categoria.js'; // unificação 2026-06-13 (collapse/trim extra é inócuo: usos tokenizam)
const stem = (t) => t.replace(/s$/, '');
const toks = (s) => [...new Set(norm(s).split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t)).map(stem))];

// O nome da lista casa com um produto comprado? (todos os tokens da lista
// presentes em QUALQUER um dos textos candidatos do produto)
export function casaNomeLista(nomeLista, candidatos) {
  const alvo = toks(nomeLista);
  if (!alvo.length) return false;
  for (const c of candidatos) {
    if (!c) continue;
    const set = new Set(toks(c));
    if (alvo.every((t) => set.has(t))) return true;
  }
  return false;
}

// Corre no fim da ingestão de cada fatura. Devolve { comprados: [nomes], restantes }.
export async function reconciliarListaComFatura(pool, faturaId) {
  const [listaItens] = await pool.query("SELECT id, nome FROM lista_item WHERE estado IN ('ativo','carrinho')");
  if (!listaItens.length) return { comprados: [], restantes: 0 };
  const [produtos] = await pool.query(
    `SELECT i.descricao_original AS d, s.nome_canonico AS c, s.nome_simplificado AS ns
       FROM item i LEFT JOIN sku_normalizado s ON s.id = i.sku_id
      WHERE i.fatura_id = ? AND i.is_non_product = 0`,
    [faturaId],
  );
  const sai = listaItens.filter((li) => produtos.some((p) => casaNomeLista(li.nome, [p.c, p.ns, p.d])));
  if (sai.length) {
    await pool.query("UPDATE lista_item SET estado = 'comprado', fatura_id = ? WHERE id IN (?)", [faturaId, sai.map((x) => x.id)]);
  }
  return { comprados: sai.map((x) => x.nome), restantes: listaItens.length - sai.length };
}

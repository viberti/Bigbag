// Busca web (Google Programmable Search / Custom Search JSON API) para enriquecer
// o match nome→EAN. Quando o token-matching local falha por ABREVIATURAS do talão
// ("BRAS"→"Braseado", "FF"→"Fatias Finas", "CUIDA-T+") que o overlap não consegue
// expandir, a busca web encontra a página do produto no continente.pt; extraímos o
// sku_fonte da URL e ligamo-lo ao catálogo (que já tem o EAN), cruzando o nome
// encontrado com a descrição do talão como rede de segurança.
//
// O motor (CSE) está restrito a continente.pt + auchan.pt → resultados sempre
// relevantes. Chaves no .env: GOOGLE_CSE_KEY, GOOGLE_CSE_CX (não versionadas).
// Free tier: 100 buscas/dia — por isso a busca é por-item, sob demanda do operador,
// nunca em lote automático.
import { saborConflito, produtoOverlap, carregarIdf } from './resolverProduto.js';

const KEY = () => process.env.GOOGLE_CSE_KEY || '';
const CX = () => process.env.GOOGLE_CSE_CX || '';

export function buscaWebDisponivel() {
  return Boolean(KEY() && CX());
}

// Extrai o sku_fonte numérico do fim da URL de produto do Continente:
//   https://www.continente.pt/produto/<slug>-2000022.html  →  "2000022"
function skuFonteDeUrl(url) {
  const m = String(url || '').match(/-(\d{5,9})\.html(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

async function chamarCse(q, { num = 3 } = {}) {
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', KEY());
  u.searchParams.set('cx', CX());
  u.searchParams.set('gl', 'pt');
  u.searchParams.set('hl', 'pt');
  u.searchParams.set('num', String(Math.min(Math.max(num, 1), 10)));
  u.searchParams.set('q', q);
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (j && j.error) {
    const e = new Error(j.error.message || 'CSE erro');
    e.code = j.error.code;
    throw e;
  }
  return Array.isArray(j?.items) ? j.items : [];
}

// Dado o nome do talão, busca no(s) site(s) do CSE e devolve candidatos do catálogo
// (com EAN) ligados pelos sku_fonte das URLs, já com cruzamento de nome.
// item: { descricao, descricaoRaw }. Devolve { disponivel, candidatos[], consultado, erro? }.
// Os candidatos NÃO são gateados (o operador é o juiz); o cruzamento (overlap/sabor)
// vai como sinal de confiança para a UI.
export async function buscarProdutoWeb(pool, item, { fonte = 'continente', num = 3 } = {}) {
  if (!buscaWebDisponivel()) return { disponivel: false, candidatos: [] };
  const desc = (item.descricaoRaw || item.descricao || '').trim();
  if (!desc) return { disponivel: true, candidatos: [] };

  let resultados;
  try {
    resultados = await chamarCse(desc, { num });
  } catch (e) {
    return { disponivel: true, erro: e.message, codigo: e.code, candidatos: [], consultado: desc };
  }

  // sku_fonte únicos, na ordem dos resultados (rank 0 = mais relevante)
  const skus = [];
  for (const it of resultados) {
    const s = skuFonteDeUrl(it.link);
    if (s && !skus.includes(s)) skus.push(s);
  }
  if (!skus.length) return { disponivel: true, candidatos: [], consultado: desc };

  const [rows] = await pool.query(
    'SELECT sku_fonte, nome, marca, ean, url, preco FROM catalogo_produto WHERE fonte=? AND sku_fonte IN (?) AND ean IS NOT NULL',
    [fonte, skus],
  );
  const porSku = new Map(rows.map((r) => [String(r.sku_fonte), r]));

  const idf = await carregarIdf(pool);
  const out = [];
  skus.forEach((s, i) => {
    const r = porSku.get(s);
    if (!r) return; // resultado sem EAN no catálogo (ainda não raspado) → ignora
    const overlap = produtoOverlap({ descricao: desc }, r.nome, r.marca, idf);
    const sabor = saborConflito(desc, r.nome);
    // confiança: 1.º resultado da busca + nome a bater bem = forte; cai com o rank e
    // com overlap baixo. Conflito de sabor zera (provável produto errado).
    const pesoRank = i === 0 ? 1 : i === 1 ? 0.8 : 0.6;
    out.push({
      ean: r.ean,
      nome: r.nome,
      marca: r.marca,
      url: r.url,
      preco: r.preco == null ? null : Number(r.preco),
      sku_fonte: s,
      rank: i,
      overlap: Math.round(overlap * 100) / 100,
      sabor_conflito: sabor,
      confianca: sabor ? 0 : Math.max(0, Math.min(1, overlap * pesoRank)),
    });
  });
  out.sort((a, b) => b.confianca - a.confianca);
  return { disponivel: true, candidatos: out, consultado: desc };
}

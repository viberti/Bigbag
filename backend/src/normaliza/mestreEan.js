// Produto Mestre POR EAN — materializa a tese: o EAN é a chave canónica, e
// agregamos TUDO o que sabemos dele de TODAS as fontes (catálogo Auchan/Continente,
// identificações em produto_ean, e Open Food Facts). Quanto mais rico, melhor o
// match (mais variantes de nome) e mais cheia a ficha (nutrição/categoria/imagem).
// (NOTA: distinto de mestre.js, que é a CHAVE facetada da taxonomia.)
import { consultarOFF } from '../ingest/produto.js';

const limpaEan = (e) => String(e || '').replace(/\D/g, '');
const parseNutri = (v) => { if (!v) return null; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

// Nomes (todas as variantes) por EAN, em lote. Devolve Map<ean, Set<nome>>.
export async function nomesPorEan(pool, eans) {
  const lista = [...new Set(eans.map(limpaEan).filter(Boolean))];
  if (!lista.length) return new Map();
  // duas queries separadas (evita "Illegal mix of collations" no UNION) e funde em JS.
  const [[cat], [pe]] = await Promise.all([
    pool.query('SELECT ean, nome FROM catalogo_produto WHERE ean IN (?) AND nome IS NOT NULL', [lista]),
    pool.query('SELECT ean, nome FROM produto_ean WHERE ean IN (?) AND nome IS NOT NULL', [lista]),
  ]);
  const m = new Map();
  for (const r of [...cat, ...pe]) {
    const k = String(r.ean);
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(r.nome);
  }
  return m;
}

// Mestre completo de UM ean: nomes, marca, categoria, nutrição, imagem, fontes.
// Usa o que já está na BD; se não houver nutrição, consulta o OFF e devolve-a.
export async function mestrePorEan(pool, ean) {
  const cod = limpaEan(ean);
  if (cod.length < 8) return null;
  const [cat] = await pool.query(
    "SELECT nome, marca, categoria_path, categoria, imagem_url, fonte FROM catalogo_produto WHERE ean=?", [cod]);
  const [pe] = await pool.query(
    "SELECT nome, marca, categoria, nutricao, off_json FROM produto_ean WHERE ean=?", [cod]);

  const nomes = [...new Set([...cat.map((r) => r.nome), ...pe.map((r) => r.nome)].filter(Boolean))];
  let marca = cat.find((r) => r.marca)?.marca || pe.find((r) => r.marca)?.marca || null;
  let categoria = cat.find((r) => r.categoria_path)?.categoria_path || pe.find((r) => r.categoria)?.categoria || null;
  const imagem = cat.find((r) => r.imagem_url)?.imagem_url || null;
  const fontes = [...new Set([...cat.map((r) => r.fonte), ...(pe.length ? ['ident'] : [])])];

  // OFF: consulta quando falta nutrição OU nome (caso EAN SÓ-OFF — dos ~21k que só
  // o OFF tem; sem isto o mestre vinha sem nome/marca). Aproveita TUDO do OFF, não
  // só a nutrição (regra P0: nenhuma fonte fica por consultar). consultarOFF é
  // local-first (lê o dump off_produto; só toca a API live se faltar).
  let nutricao = parseNutri(pe.find((r) => r.nutricao)?.nutricao);
  let off = parseNutri(pe.find((r) => r.off_json)?.off_json);
  if (!nutricao || !nomes.length) {
    const c = await consultarOFF(cod);
    if (c) {
      if (!nutricao) nutricao = c.nutricao_100g;
      off = off || c;
      const nomeOff = c.nome_pt || c.nome;
      if (!nomes.length && nomeOff) nomes.push(nomeOff);
      if (!marca && c.marca) marca = c.marca;
      if (!categoria && c.categoria) categoria = c.categoria;
      if (!fontes.includes('off')) fontes.push('off');
    }
  }
  return { ean: cod, nomes, marca, categoria, imagem, fontes, nutricao, off, n_fontes: fontes.length };
}

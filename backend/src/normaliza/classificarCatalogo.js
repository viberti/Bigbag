// CLASSIFICAÇÃO POR CATÁLOGO (estratégia do dono, 2026-06-13 — Fase 1):
// usar as categorias das LOJAS (Continente/PD/Auchan/Mercadona) para classificar
// um produto, COM ou SEM EAN. Com EAN: as linhas diretas do catálogo votam.
// Sem EAN: os VIZINHOS por nome (vizinhosCatalogo) votam. O voto é ponderado
// pela PROFUNDIDADE do caminho — a folha de 4 níveis do Auchan
// ("…/polpas-caldos-e-temperos/polpa-tomate") vale mais que o "Mercearia"
// raso do Continente — e caminhos estrangeiros (Mercadona ES, tags 'en:')
// valem metade. Determinístico, zero LLM.
//
// O caminho COMPLETO guarda-se para análise; ao utilizador mostra-se só a
// FOLHA (decisão do dono: "Mercearia > Molhos…" exibe "Molhos"). A folha
// minerada PROPÕE; o vocabulário fechado (tipoConsumidor) DISPÕE — a adoção
// de novos tipos de UI é curada, não automática (Fase 2).
import { normAlfa, grupoDeTexto } from './categoria.js';
import { vizinhosCatalogo } from './resolverProduto.js';

// Níveis sem informação de classificação (raiz administrativa dos sites).
const NIVEL_RUIDO = new Set(['alimentacao', 'produtos', 'home', 'todos']);
const CONECTOR = new Set(['e', 'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'y']);

// ── puros (exportados p/ testes) ─────────────────────────────────────────────

// Parte um caminho de loja em níveis legíveis. `es` marca vocabulário não-PT
// (Mercadona em espanhol; tags OFF 'en:…') — vota com peso reduzido na folha.
export function niveisDePath(fonte, path) {
  if (!path) return null;
  const niveis = String(path).split('/').map((n) => n.trim()).filter((n) => n && !NIVEL_RUIDO.has(normAlfa(n).replace(/ /g, '')));
  if (!niveis.length) return null;
  const folha = niveis[niveis.length - 1];
  const es = fonte === 'mercadona' || /^[a-z]{2}:/.test(folha);
  return { niveis, folha, profundidade: niveis.length, es };
}

// Folha legível para exibição: kebab→espaços, conectores minúsculos, resto
// capitalizado. (Rótulo provisório — a Fase 2 cura o vocabulário de UI.)
export function exibirFolha(folha) {
  if (!folha) return null;
  return String(folha).replace(/^[a-z]{2}:/, '').split(/[-\s]+/).filter(Boolean)
    .map((w, i) => (i > 0 && CONECTOR.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

// O voto: candidatos {fonte, path[, score]} → vencedor por FOLHA normalizada,
// peso = profundidade do caminho (cap 4; ES/estrangeiro × 0.5).
// Folhas equivalentes de lojas diferentes ("polpa-tomate" vs
// "polpas-e-concentrados") ainda NÃO somam — fragmentam o voto e baixam a
// confiança (honesto); o mapa de equivalência minerado por EAN é a Fase 3.
export function votarCategoria(cands) {
  const grupos = new Map(); // normAlfa(folha) → { folha, path, fonte, peso, n }
  let total = 0;
  for (const c of cands || []) {
    const nd = niveisDePath(c.fonte, c.path);
    if (!nd) continue;
    const peso = Math.min(nd.profundidade, 4) * (nd.es ? 0.5 : 1);
    total += peso;
    const k = normAlfa(nd.folha);
    const g = grupos.get(k) || { folha: nd.folha, path: c.path, fonte: c.fonte, profundidade: nd.profundidade, peso: 0, n: 0 };
    g.peso += peso; g.n += 1;
    // representante do grupo: o caminho mais fundo visto
    if (nd.profundidade > g.profundidade) { g.path = c.path; g.fonte = c.fonte; g.profundidade = nd.profundidade; }
    grupos.set(k, g);
  }
  if (!grupos.size) return null;
  const lista = [...grupos.values()].sort((a, b) => b.peso - a.peso || b.n - a.n);
  const v = lista[0];
  return {
    folha: exibirFolha(v.folha), path: v.path, fonte: v.fonte,
    confianca: Math.round((v.peso / total) * 100) / 100,
    votos: lista.slice(0, 5).map((g) => ({ folha: exibirFolha(g.folha), n: g.n, peso: Math.round(g.peso * 10) / 10 })),
  };
}

// ── orquestração ─────────────────────────────────────────────────────────────
// Classifica por catálogo: EAN primeiro (linhas diretas), senão vizinhança por
// nome. Devolve { via, folha, path, fonte, confianca, n, grupo, votos } ou null.
export async function classificarPorCatalogo(pool, { nome = null, ean = null } = {}) {
  let cands = [], via = null;
  if (ean) {
    const [rows] = await pool.query(
      `SELECT fonte, COALESCE(NULLIF(categoria_path,''), categoria) AS path FROM catalogo_produto
       WHERE ean = ? AND COALESCE(NULLIF(categoria_path,''), NULLIF(categoria,'')) IS NOT NULL`, [ean]);
    if (rows.length) { cands = rows; via = 'ean'; }
  }
  if (!cands.length && nome) {
    const viz = await vizinhosCatalogo(pool, nome, { k: 80, minScore: 0.5 });
    cands = viz.map((v) => ({ fonte: v.fonte, path: v.categoria_path }));
    via = 'vizinhanca';
  }
  const voto = votarCategoria(cands);
  if (!voto) return null;
  return { via, n: cands.length, grupo: grupoDeTexto(voto.path), ...voto };
}

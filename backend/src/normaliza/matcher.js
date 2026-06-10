// Camada 2+3 — resolver uma descrição de talão para um sku_normalizado.
//   1) alias exato (cache) → instantâneo
//   2) canonicalizar (LLM) → nome_canónico + marca + unidade
//   3) candidatos = SKUs com mesma marca + unidade; pontua por SIMILARIDADE de
//      nome (Camada 3) sobre os de formato compatível e decide:
//        score ≥ limiarAuto        → match
//        limiarRevisao ≤ s < auto  → confirmar por LLM (se houver juiz), senão revisão
//        s < limiarRevisao         → criar SKU novo
//      Exceção: nome canónico IDÊNTICO (livre de formato) reutiliza sempre o SKU,
//      mesmo com formato diferente — não cria duplicados iguais.
//   4) grava alias para a próxima vez.
// `canonicalizar` e `confirmar` são injetados (testes usam stubs).
import { extrairFormato } from './formato.js';
import { canonicalizar as canonicalizarLLM, confirmarMesmoProduto } from './canonical.js';
import { melhorCandidato, normalizarNome } from './similaridade.js';
import { limparDescricao } from './mestre.js';
import { buscarCatalogo } from './resolverProduto.js';
import { marcaDeterministica } from './marca.js';
import { compararFacetas } from './facetas.js';

const formatoProximo = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= 0.01;
};

// Categorias vendidas À UNIDADE que mesmo assim trazem um peso na descrição,
// que NÃO é a base de comparação: o "53-63G" de um ovo é o calibre, o "90G" de
// um sabonete é o peso da barra (compara-se por unidade). Lista curta e extensível.
const PALAVRAS_CONTADAS = /\bovos?\b|\bd[uú]zias?\b|sabonete/i;

// Peça CORTADA de fruta grande / a granel: vendida a PESO mesmo sem kg na nota
// (ex.: "MAMÃO PARTIDO", "MELANCIA PARTIDA", "MELÃO METADE"). Força kg → o €/kg
// fica incomputável-honesto (null) em vez de um €/peça enganador (peças variam).
const PESADO_A_GRANEL = /\bpartid[oa]s?\b|\bmetades?\b|\bao\s*kg\b|\bgranel\b/i;

// Decide a unidade_base do SKU. REGRA: o formato determinístico GANHA ao LLM
// quando há peso/volume EXPLÍCITO na descrição (g/kg/ml/cl/L, incl. multipack
// "4X125G" = 500 g) — o LLM erra a unidade de fruta/legumes/queijo a peso
// (DIOSPIRO 350G → 'un'). Volume → sempre L (seguro). Exceção: categorias
// CONTADAS (ovos, sabonete) ficam com o 'un' do LLM. Sem peso/volume no
// formato, usa a unidade do LLM (como antes). Pura → testável sem BD/LLM.
export function decidirUnidadeBase(c, fmt, descRaw = '') {
  const temPesoVolume = fmt?.unidade_base === 'kg' || fmt?.unidade_base === 'L';
  const contado = PALAVRAS_CONTADAS.test(`${c?.nome_canonico || ''} ${c?.categoria || ''}`);
  if (temPesoVolume && !contado) return fmt.unidade_base;
  if (PESADO_A_GRANEL.test(descRaw)) return 'kg'; // peça cortada/granel → vendida a peso
  return c?.unidade_base || fmt?.unidade_base || 'un';
}

export async function resolverSku(
  db,
  descricaoOriginal,
  { canonicalizar = canonicalizarLLM, confirmar = confirmarMesmoProduto, limiarAuto = 0.85, limiarRevisao = 0.6, cadeia } = {},
) {
  const descRaw = String(descricaoOriginal || '').trim();
  // Chave do alias = descrição LIMPA (sem qtd/peso/preço/IVA). Antes a chave era a
  // linha crua, com o peso variável por compra (x1,056 vs x1,670) → a MESMA banana
  // nunca reusava o alias e re-corria fuzzy/LLM. Limpa estabiliza o cache.
  const desc = limparDescricao(descRaw) || descRaw;

  // 1) alias exato (cache) — mantém a confiança gravada no alias
  const [al] = await db.query('SELECT sku_id, confianca FROM sku_alias WHERE descricao_original = ?', [desc]);
  if (al.length) return { sku_id: al[0].sku_id, via: 'alias', confianca: al[0].confianca };

  // 2) canonicalizar (com contexto da cadeia + pista do motor de busca interno:
  // o produto real provável no catálogo — determinístico, ancora o LLM)
  let pistaCatalogo = null;
  try {
    const b = await buscarCatalogo(db, desc, { cadeia, limiar: 0.62 });
    // margem baixa = empate entre produtos DISTINTOS (descrições genéricas tipo
    // "BANANA" cobrem dezenas) → a pista seria arbitrária; melhor nenhuma.
    if (b && b.margem >= 0.05) pistaCatalogo = b;
  } catch { /* sem catálogo → segue sem pista */ }
  // Marca DETERMINÍSTICA antes do LLM (marcador de cadeia / gazetteer do catálogo):
  // quando bate, ganha ao palpite — e a proveniência fica registada (marca_origem).
  let marcaDet = null;
  try { marcaDet = await marcaDeterministica(db, descRaw); } catch { /* segue p/ LLM */ }
  const c = await canonicalizar(desc, { cadeia, pistaCatalogo, marcaDetetada: marcaDet?.marca });
  if (marcaDet) c.marca = marcaDet.marca;
  if (!c || (c.confianca != null && c.confianca < limiarRevisao)) {
    return { sku_id: null, via: 'revisao', canonical: c || null };
  }

  // Formato/peso extrai-se da linha CRUA (o peso é o sinal: "kg x1,056" etc.).
  const fmt = extrairFormato(descRaw);
  // peso variável (€/kg) não tem formato fixo
  const formato_valor = fmt.quantidadeKg != null ? null : fmt.formato_valor ?? null;
  const unidade_base = decidirUnidadeBase(c, fmt, descRaw);

  // 3) candidatos: mesma marca + unidade + formato compatível
  const [cands] = await db.query(
    'SELECT id, nome_canonico, formato_valor FROM sku_normalizado WHERE (marca <=> ?) AND unidade_base = ?',
    [c.marca, unidade_base],
  );
  // GATE de facetas (A6): sabor/teor/dieta em CONFLITO = produtos diferentes —
  // o Dice tratava "morango" como token qualquer e auto-fundia "Grego Natural
  // Magro" com "Grego Natural" a 0,857. Conflito → candidato fora, por regra.
  const fonteFacetas = `${desc} ${c.nome_canonico}`;
  const compat = cands.filter(
    (s) => formatoProximo(s.formato_valor, formato_valor) && compararFacetas(fonteFacetas, s.nome_canonico) !== 'conflito',
  );
  let { candidato, score } = melhorCandidato(c.nome_canonico, compat);
  // Dedup de nome EXATO: o nome_canonico é livre de formato, logo dois SKUs com
  // o mesmo nome (mesma marca/unidade) SÃO o mesmo produto — reutiliza, mesmo
  // que o formato difira. Evita criar duplicados idênticos a cada ingestão.
  if (score < limiarAuto) {
    const alvo = normalizarNome(c.nome_canonico);
    const exato = cands.find((s) => normalizarNome(s.nome_canonico) === alvo);
    if (exato) {
      candidato = exato;
      score = 1;
    }
  }

  // Política do AUSENTE (Taxonomia §11.3): o candidato declara uma faceta que a
  // fonte omite (ou vice-versa) → nunca auto-match; baixa para a banda do juiz.
  if (candidato && score >= limiarAuto && compararFacetas(fonteFacetas, candidato.nome_canonico) === 'ausente') {
    score = Math.max(limiarRevisao, limiarAuto - 0.01);
  }

  let sku_id = null;
  let via = null;
  if (candidato && score >= limiarAuto) {
    sku_id = candidato.id;
    via = 'match';
  } else if (candidato && score >= limiarRevisao && confirmar) {
    const ok = await confirmar(c.nome_canonico, candidato.nome_canonico);
    if (ok) {
      sku_id = candidato.id;
      via = 'match-llm';
    }
  }

  if (!sku_id) {
    const [r] = await db.query(
      'INSERT INTO sku_normalizado (nome_canonico, marca, marca_origem, categoria, unidade_base, formato_valor) VALUES (?,?,?,?,?,?)',
      [c.nome_canonico, c.marca, c.marca ? (marcaDet?.origem || 'llm') : null, c.categoria, unidade_base, formato_valor],
    );
    sku_id = r.insertId;
    via = 'novo';
  }

  // Confiança do mapeamento, por via (ver migração 016). Fica no alias → durável.
  const conf = via === 'match' ? 90 : via === 'match-llm' ? 75 : 60; // novo → 60
  await db.query('INSERT IGNORE INTO sku_alias (descricao_original, sku_id, origem, confianca) VALUES (?,?,?,?)', [
    desc,
    sku_id,
    'llm',
    conf,
  ]);
  return { sku_id, via, score: Math.round(score * 100) / 100, confianca: conf, canonical: c };
}

// Resolve o sku_id de todos os itens (ainda sem SKU) de UMA fatura. Corre FORA
// de qualquer transação — faz chamadas ao LLM (lentas) — e é best-effort: usa-se
// na ingestão para já gravar o produto canónico; o script de lote é a rede de
// segurança para o que falhar. Sequencial de propósito (evita criar SKUs
// duplicados em corrida quando duas descrições novas mapeiam ao mesmo produto).
export async function normalizarItensFatura(db, faturaId, opts = {}) {
  const [rows] = await db.query(
    'SELECT DISTINCT descricao_original FROM item WHERE fatura_id = ? AND sku_id IS NULL AND is_non_product = FALSE',
    [faturaId],
  );
  const cont = { novo: 0, match: 0, 'match-llm': 0, alias: 0, revisao: 0, erro: 0 };
  for (const { descricao_original } of rows) {
    try {
      const r = await resolverSku(db, descricao_original, opts);
      if (r.sku_id) {
        await db.query(
          'UPDATE item SET sku_id = ? WHERE fatura_id = ? AND descricao_original = ? AND sku_id IS NULL',
          [r.sku_id, faturaId, descricao_original],
        );
      }
      cont[r.via] = (cont[r.via] || 0) + 1;
    } catch {
      cont.erro++;
    }
  }
  return cont;
}

// Funde SKUs com nome canónico IDÊNTICO (normalizado) num só (mantém o mais
// usado), movendo itens e aliases. `soNomesRaw` (opcional) limita aos nomes
// dados — usado na ingestão para juntar só os da nota nova; sem ele, varre tudo
// (botão "auto-merge" do /admin). Devolve { grupos, removidos }.
export async function mergeNomesIdenticos(db, soNomesRaw) {
  const filtro = soNomesRaw ? new Set([...soNomesRaw].map((x) => normalizarNome(x)).filter(Boolean)) : null;
  const [skus] = await db.query(
    'SELECT s.id, s.nome_canonico, COUNT(i.id) AS n FROM sku_normalizado s LEFT JOIN item i ON i.sku_id = s.id GROUP BY s.id',
  );
  const grupos = new Map();
  for (const s of skus) {
    const k = normalizarNome(s.nome_canonico);
    if (!k || (filtro && !filtro.has(k))) continue;
    (grupos.get(k) || grupos.set(k, []).get(k)).push(s);
  }
  let removidos = 0;
  let nGrupos = 0;
  for (const arr of grupos.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => b.n - a.n);
    const para = arr[0].id;
    for (let i = 1; i < arr.length; i++) {
      const de = arr[i].id;
      await db.query('UPDATE item SET sku_id = ? WHERE sku_id = ?', [para, de]);
      await db.query("UPDATE sku_alias SET sku_id = ?, origem = 'manual', confianca = 100 WHERE sku_id = ?", [para, de]);
      await db.query('DELETE FROM sku_normalizado WHERE id = ?', [de]);
      removidos++;
    }
    nGrupos++;
  }
  return { grupos: nGrupos, removidos };
}

// Apaga SKUs SEM itens e SEM alias manual — órfãos do "drift" de descrição no
// reprocesso (a re-extração muda ligeiramente o texto → re-canonicaliza para
// outro SKU e deixa o antigo vazio). NUNCA apaga SKUs com alias `manual`
// (curadoria do operador), mesmo que estejam a zero. Devolve { removidos }.
export async function limparSkusOrfaos(db) {
  const [orf] = await db.query(
    `SELECT s.id FROM sku_normalizado s
      WHERE NOT EXISTS (SELECT 1 FROM item i WHERE i.sku_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM sku_alias a WHERE a.sku_id = s.id AND a.origem = 'manual')`,
  );
  if (!orf.length) return { removidos: 0 };
  const ids = orf.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  await db.query(`DELETE FROM sku_alias WHERE sku_id IN (${ph})`, ids);
  await db.query(`DELETE FROM sku_normalizado WHERE id IN (${ph})`, ids);
  return { removidos: ids.length };
}

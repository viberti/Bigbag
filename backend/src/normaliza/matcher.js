// Camada 2+3 — resolver uma descrição de talão para um sku_normalizado.
//   1) alias exato (cache) → instantâneo
//   2) canonicalizar (LLM) → nome_canónico + marca + unidade
//   3) candidatos = SKUs com mesma marca + unidade + formato compatível;
//      pontua por SIMILARIDADE de nome (Camada 3) e decide:
//        score ≥ limiarAuto        → match
//        limiarRevisao ≤ s < auto  → confirmar por LLM (se houver juiz), senão revisão
//        s < limiarRevisao         → criar SKU novo
//   4) grava alias para a próxima vez.
// `canonicalizar` e `confirmar` são injetados (testes usam stubs).
import { extrairFormato } from './formato.js';
import { canonicalizar as canonicalizarLLM, confirmarMesmoProduto } from './canonical.js';
import { melhorCandidato } from './similaridade.js';

const formatoProximo = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= 0.01;
};

export async function resolverSku(
  db,
  descricaoOriginal,
  { canonicalizar = canonicalizarLLM, confirmar = confirmarMesmoProduto, limiarAuto = 0.85, limiarRevisao = 0.6 } = {},
) {
  const desc = String(descricaoOriginal || '').trim();

  // 1) alias exato (cache)
  const [al] = await db.query('SELECT sku_id FROM sku_alias WHERE descricao_original = ?', [desc]);
  if (al.length) return { sku_id: al[0].sku_id, via: 'alias' };

  // 2) canonicalizar
  const c = await canonicalizar(desc);
  if (!c || (c.confianca != null && c.confianca < limiarRevisao)) {
    return { sku_id: null, via: 'revisao', canonical: c || null };
  }

  const fmt = extrairFormato(desc);
  // peso variável (€/kg) não tem formato fixo
  const formato_valor = fmt.quantidadeKg != null ? null : fmt.formato_valor ?? null;
  const unidade_base = c.unidade_base || fmt.unidade_base || 'un';

  // 3) candidatos: mesma marca + unidade + formato compatível
  const [cands] = await db.query(
    'SELECT id, nome_canonico, formato_valor FROM sku_normalizado WHERE (marca <=> ?) AND unidade_base = ?',
    [c.marca, unidade_base],
  );
  const compat = cands.filter((s) => formatoProximo(s.formato_valor, formato_valor));
  const { candidato, score } = melhorCandidato(c.nome_canonico, compat);

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
      'INSERT INTO sku_normalizado (nome_canonico, marca, categoria, unidade_base, formato_valor) VALUES (?,?,?,?,?)',
      [c.nome_canonico, c.marca, c.categoria, unidade_base, formato_valor],
    );
    sku_id = r.insertId;
    via = 'novo';
  }

  await db.query('INSERT IGNORE INTO sku_alias (descricao_original, sku_id, origem) VALUES (?,?,?)', [desc, sku_id, 'llm']);
  return { sku_id, via, score: Math.round(score * 100) / 100, canonical: c };
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

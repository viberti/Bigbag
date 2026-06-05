// Camada 2 — resolver uma descrição de talão para um sku_normalizado.
// Ordem por confiança crescente em custo:
//   1) alias exato (cache) → instantâneo, sem erro
//   2) canonicalizar (LLM) → encontrar SKU existente (nome+marca+formato) ou criar
//   3) confiança baixa → não liga; fica para revisão
// `canonicalizar` é injetado (testes usam stub; produção usa canonical.js).
import { extrairFormato } from './formato.js';
import { canonicalizar as canonicalizarLLM } from './canonical.js';

const formatoProximo = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= 0.01; // tolerância de formato
};

export async function resolverSku(db, descricaoOriginal, { canonicalizar = canonicalizarLLM, limiarRevisao = 0.6 } = {}) {
  const desc = String(descricaoOriginal || '').trim();

  // 1) alias exato (cache) — collation utf8mb4_unicode_ci ignora caixa/acentos.
  const [al] = await db.query('SELECT sku_id FROM sku_alias WHERE descricao_original = ?', [desc]);
  if (al.length) return { sku_id: al[0].sku_id, via: 'alias' };

  // 2) canonicalizar
  const c = await canonicalizar(desc);
  if (!c || (c.confianca != null && c.confianca < limiarRevisao)) {
    return { sku_id: null, via: 'revisao', canonical: c || null };
  }

  const fmt = extrairFormato(desc);
  // Itens a peso variável (vendidos a €/kg) NÃO têm formato fixo — o peso é por
  // compra (quantidade), não um atributo do SKU. Senão cada compra vira um SKU.
  const formato_valor = fmt.quantidadeKg != null ? null : fmt.formato_valor ?? null;
  const unidade_base = c.unidade_base || fmt.unidade_base || 'un';

  // 3) procurar SKU existente: mesmo nome (classe) + marca + unidade, formato próximo.
  const [skus] = await db.query(
    'SELECT id, formato_valor FROM sku_normalizado WHERE nome_canonico = ? AND (marca <=> ?) AND unidade_base = ?',
    [c.nome_canonico, c.marca, unidade_base],
  );
  const existente = skus.find((s) => formatoProximo(s.formato_valor, formato_valor));

  let sku_id;
  let via;
  if (existente) {
    sku_id = existente.id;
    via = 'match';
  } else {
    const [r] = await db.query(
      'INSERT INTO sku_normalizado (nome_canonico, marca, categoria, unidade_base, formato_valor) VALUES (?,?,?,?,?)',
      [c.nome_canonico, c.marca, c.categoria, unidade_base, formato_valor],
    );
    sku_id = r.insertId;
    via = 'novo';
  }

  // 4) gravar alias (cache) para a próxima vez.
  await db.query('INSERT IGNORE INTO sku_alias (descricao_original, sku_id, origem) VALUES (?,?,?)', [desc, sku_id, 'llm']);
  return { sku_id, via, canonical: c };
}

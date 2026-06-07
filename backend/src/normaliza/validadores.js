// Validadores de atribuição ao Produto Mestre — sinais BARATOS que apanham
// misclassificações (tipo "b": caldo→ovos, detergente→filtro) automaticamente,
// reduzindo a revisão manual ao mínimo. NÃO são matchers (não criam grupos) —
// são GUARDAS: dizem quando uma atribuição é IMPLAUSÍVEL. Lógica pura, testável.

function mediana(xs) {
  const a = xs.filter((x) => Number.isFinite(x) && x > 0).sort((p, q) => p - q);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// (1) UNIDADE: o mesmo Mestre compara-se na MESMA unidade. Unidade diferente
// (ovos €/un vs caldo €/L) → quase de certeza NÃO é o mesmo produto. Sem info → não bloqueia.
export function unidadeCompativel(a, b) {
  if (!a || !b) return true;
  return String(a) === String(b);
}

// (2) €/base: um membro grosseiramente fora da mediana do Mestre é suspeito.
// Limiar GENEROSO (marca ~4×, dose ~2× são legítimos) → só apanha anomalias grosseiras.
// Sem €/base ou poucos pontos de referência → não bloqueia (sinal honesto).
export function precoPlausivel(precoBase, precosMestre, { fator = 6 } = {}) {
  if (!Number.isFinite(precoBase) || precoBase <= 0) return true;
  const med = mediana(precosMestre || []);
  if (!med || (precosMestre || []).filter((x) => Number.isFinite(x) && x > 0).length < 2) return true;
  const r = precoBase / med;
  return r <= fator && r >= 1 / fator;
}

// (3) MARCA→AFINIDADE: dada a distribuição histórica da marca por categoria
// ({categoria: contagem}), uma categoria que uma marca ESPECIALISTA nunca fez é
// suspeita. Marca desconhecida, com poucos dados, ou GENERALISTA → não constrange.
export function marcaCompativel(categoria, afinidadeDaMarca, { minTotal = 3, maxCategorias = 4 } = {}) {
  if (!afinidadeDaMarca || !categoria) return true;
  const total = Object.values(afinidadeDaMarca).reduce((s, n) => s + n, 0);
  if (total < minTotal) return true; // poucos dados
  if (Object.keys(afinidadeDaMarca).length > maxCategorias) return true; // generalista (faz de tudo)
  return (afinidadeDaMarca[categoria] || 0) > 0; // especialista: a categoria tem de já ter aparecido
}

// Combina os três guardas. `ctx`: { unidadeMestre, precosMestre, afinidadeDaMarca }.
// Devolve { ok, motivos[] } — ok=false ⇒ marcar SUSPEITO em vez de fundir em silêncio.
export function validarAtribuicao({ unidade, precoBase, categoria } = {}, ctx = {}) {
  const motivos = [];
  if (!unidadeCompativel(unidade, ctx.unidadeMestre)) motivos.push('unidade incompatível (' + unidade + ' vs ' + ctx.unidadeMestre + ')');
  if (!precoPlausivel(precoBase, ctx.precosMestre)) motivos.push('€/base anómalo vs o Mestre');
  if (!marcaCompativel(categoria, ctx.afinidadeDaMarca)) motivos.push('marca não faz esta categoria');
  return { ok: motivos.length === 0, motivos };
}

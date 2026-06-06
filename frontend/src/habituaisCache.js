// Cache offline da lista de produtos habituais (stale-while-revalidate).
// A PWA é usada DENTRO do supermercado, onde a rede falha: guardamos a última
// lista boa em localStorage para a app abrir, ver os habituais e montar o
// carrinho SEM rede. A lista muda devagar (recorrência de 60 dias), por isso
// uma versão ligeiramente desatualizada continua perfeitamente utilizável.
const CHAVE = 'bigbag_habituais';

export function lerCacheHabituais() {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return null;
    const o = JSON.parse(cru);
    if (!o || !Array.isArray(o.produtos)) return null;
    return { produtos: o.produtos, ts: o.ts || null };
  } catch {
    return null;
  }
}

export function gravarCacheHabituais(produtos) {
  const ts = Date.now();
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ produtos: produtos || [], ts }));
  } catch {
    /* quota cheia / modo privado: a cache é best-effort, não rebenta a app */
  }
  return ts;
}

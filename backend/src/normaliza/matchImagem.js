// MATCH POR IMAGEM (2026-06-13): dada uma foto de um produto novo (scan do
// utilizador, ou produto de catálogo SEM EAN), encontra o produto mais parecido
// na base de vetores (Qdrant), por aparência visual. Liga ao resolvedor de
// entidades (mesmo produto, EANs diferentes) e ao scan→ficha sem EAN resolúvel.
//   vetorizar (serviço bigbag-infer) → buscar top-k no Qdrant → gate de cosseno.
const INFER = process.env.INFER_URL || 'http://localhost:8900';
const QDRANT = process.env.QDRANT_URL || 'http://localhost:6333';
const COLECCAO = process.env.QDRANT_COLLECTION || 'produtos_img';

// Vetoriza uma imagem em base64 (sem o prefixo data:). Devolve o vetor ou null.
export async function vetorizarImagemB64(b64) {
  const r = await fetch(`${INFER}/embed`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ b64: [b64] }), signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`infer ${r.status}`);
  const d = await r.json();
  return d.itens?.[0]?.vec || null;
}

// Busca os k produtos mais parecidos por vetor. Agrega por EAN (uma EAN pode ter
// várias fotos = vários pontos; fica o melhor score = voto multi-foto natural).
// `limiar` = cosseno mínimo p/ considerar match (calibrar com dados).
export async function matchPorVetor(vec, { k = 10, limiar = 0 } = {}) {
  const r = await fetch(`${QDRANT}/collections/${COLECCAO}/points/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vector: vec, limit: k, with_payload: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`qdrant ${r.status}`);
  const d = await r.json();
  const porEan = new Map();
  for (const p of d.result || []) {
    const ean = p.payload?.ean;
    if (!ean || p.score < limiar) continue;
    const ex = porEan.get(ean);
    if (!ex || p.score > ex.score) porEan.set(ean, { ean, fonte: p.payload.fonte, score: Math.round(p.score * 1000) / 1000 });
  }
  return [...porEan.values()].sort((a, b) => b.score - a.score);
}

// Conveniência: imagem b64 → candidatos por EAN.
export async function matchImagemB64(b64, opts) {
  const vec = await vetorizarImagemB64(b64);
  if (!vec) return [];
  return matchPorVetor(vec, opts);
}

// Estado do subsistema (p/ health/diagnóstico).
export async function estadoMatchImagem() {
  try {
    const [h, c] = await Promise.all([
      fetch(`${INFER}/health`).then((r) => r.json()),
      fetch(`${QDRANT}/collections/${COLECCAO}`).then((r) => r.json()),
    ]);
    return { modelo: h.modelo, dim: h.dim, vetores: c.result?.points_count ?? 0 };
  } catch (e) { return { erro: e.message }; }
}

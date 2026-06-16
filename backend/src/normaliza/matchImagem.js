// MATCH POR IMAGEM (2026-06-13): dada uma foto de um produto novo (scan do
// utilizador, ou produto de catálogo SEM EAN), encontra o produto mais parecido
// na base de vetores (Qdrant), por aparência visual. Liga ao resolvedor de
// entidades (mesmo produto, EANs diferentes) e ao scan→ficha sem EAN resolúvel.
//   vetorizar (serviço bigbag-infer) → buscar top-k no Qdrant → gate de cosseno.
import { createHash } from 'node:crypto';

const INFER = process.env.INFER_URL || 'http://localhost:8900';
const QDRANT = process.env.QDRANT_URL || 'http://localhost:6333';
const COLECCAO = process.env.QDRANT_COLLECTION || 'produtos_img';

// id do ponto Qdrant para um vetor persistido por EAN. NÃO pode ser Number(ean): os EANs-lixo
// curtos do OFF (ex.: "000000000054" → 54) COLIDIRIAM com os ids inteiros das linhas de catálogo
// (que o bulk usa). UUIDv5 determinístico do EAN → à prova de colisão e idempotente (mesmo EAN →
// mesmo id). Qdrant aceita ids inteiros (catálogo) e UUID (estes) na mesma coleção.
const NS_UUID = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex'); // namespace URL (RFC 4122)
export function uuidDoEan(ean) {
  const b = createHash('sha1').update(NS_UUID).update('bigbag-ean:' + String(ean)).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // versão 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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

// Vetoriza VÁRIAS imagens b64 num só pedido (batch). Devolve um vetor (ou null) por
// imagem, na mesma ordem. Usado no enriquecimento on-demand: baixar as fotos dos
// candidatos de TEXTO (OFF, não vetorizados) e compará-las por cosseno DIRETO.
export async function vetorizarVariasB64(b64s) {
  if (!b64s?.length) return [];
  const r = await fetch(`${INFER}/embed`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ b64: b64s }), signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`infer ${r.status}`);
  const d = await r.json();
  return (d.itens || []).map((it) => it.vec || null);
}

// Cosseno entre dois vetores (mesma dim). Para comparar a foto do utilizador com a foto
// de um candidato vetorizado on-demand (que NÃO está no Qdrant).
export function cosseno(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
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
    // `id` = id do ponto Qdrant = id da linha de catálogo (a FOTO exata que casou) → serve a
    // miniatura recortada no carrossel. Só os pontos de CATÁLOGO têm id inteiro; os persistidos
    // on-demand/fila têm UUID (sem foto local) → id null (o consumidor cai na imagem_url).
    const id = typeof p.id === 'number' ? p.id : null;
    if (!ex || p.score > ex.score) porEan.set(ean, { ean, id, fonte: p.payload.fonte, score: Math.round(p.score * 1000) / 1000 });
  }
  return [...porEan.values()].sort((a, b) => b.score - a.score);
}

// Conveniência: imagem b64 → candidatos por EAN.
export async function matchImagemB64(b64, opts) {
  const vec = await vetorizarImagemB64(b64);
  if (!vec) return [];
  return matchPorVetor(vec, opts);
}

// Persiste vetores no Qdrant — o corpo cresce das buscas REAIS (amortiza o download lento
// do OFF: baixa-se uma vez, da 2.ª já cá está). pontos: [{ean, vec, fonte}]. id do ponto =
// `uuidDoEan(ean)` (UUIDv5) — NÃO Number(ean): EANs-lixo curtos do OFF colidiam com os ids
// inteiros de catálogo. Idempotente (mesmo EAN → mesmo id). Fire-and-forget; SEM ?wait.
export async function upsertVetores(pontos) {
  const points = (pontos || [])
    .filter((p) => p.vec && /^\d{8,14}$/.test(String(p.ean)))
    .map((p) => ({ id: uuidDoEan(p.ean), vector: p.vec, payload: { ean: String(p.ean), fonte: p.fonte || 'on-demand' } }));
  if (!points.length) return;
  const r = await fetch(`${QDRANT}/collections/${COLECCAO}/points`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points }), signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`qdrant upsert ${r.status}`);
}

// Quais destes EANs já têm vetor no Qdrant (qualquer fonte: catálogo OU persistidos por EAN).
// Filtra por PAYLOAD ean (não por id) → independente do esquema de id, sem colisões. `should` = OR
// (amplamente suportado). Usado pelo worker da fila p/ não re-baixar o que já está no corpo.
export async function eansNoQdrant(eans) {
  const lista = [...new Set((eans || []).map(String))];
  if (!lista.length) return new Set();
  try {
    const r = await fetch(`${QDRANT}/collections/${COLECCAO}/points/scroll`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filter: { should: lista.map((e) => ({ key: 'ean', match: { value: e } })) }, with_payload: true, with_vector: false, limit: lista.length }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return new Set();
    const d = await r.json();
    return new Set((d.result?.points || []).map((p) => String(p.payload?.ean)));
  } catch { return new Set(); }
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

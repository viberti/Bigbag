// BULK de vetorização (match-por-imagem): para cada foto de catálogo com EAN
// ainda sem vetor → baixa p/ /var/lib/bigbag/imagens/{id}.jpg → serviço de
// inferência /embed → upsert no Qdrant (point_id=id, payload {ean,fonte}) →
// marca foto_em/vetor_em. Reentrante (continua de onde parou). Idempotente.
//   sudo -u dev node --env-file=.env scripts/bulk_vetorizar.mjs [--limite=N]
import { writeFile, access, mkdir } from 'node:fs/promises';
import { getPool } from '../src/db.js';

const INFER = process.env.INFER_URL || 'http://localhost:8900';
const QDRANT = process.env.QDRANT_URL || 'http://localhost:6333';
const COLECCAO = process.env.QDRANT_COLLECTION || 'produtos_img';
const IMG_DIR = process.env.IMG_DIR || '/var/lib/bigbag/imagens';
const LOTE = 48;
const LIMITE = Number((process.argv.find((a) => a.startsWith('--limite=')) || '').split('=')[1] || 0);

const j = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text().catch(() => '')}`); return r.json(); };
await mkdir(IMG_DIR, { recursive: true }).catch(() => {});

// dimensão = a do modelo carregado no serviço; cria a coleção se faltar
const health = await j(`${INFER}/health`);
const DIM = health.dim;
console.log(`modelo: ${health.modelo} · dim ${DIM} · coleção ${COLECCAO}`);
const col = await fetch(`${QDRANT}/collections/${COLECCAO}`);
if (col.status === 404) {
  await fetch(`${QDRANT}/collections/${COLECCAO}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vectors: { size: DIM, distance: 'Cosine' } }) });
  console.log('coleção criada');
}

const pool = getPool();
const baixar = async (url, dest) => {
  try { await access(dest); return true; } catch { /* baixar */ }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/')) return false;
    await writeFile(dest, Buffer.from(await r.arrayBuffer())); return true;
  } catch { return false; }
};

let total = 0, falhas = 0;
const t0 = Date.now();
while (true) {
  if (LIMITE && total >= LIMITE) break;
  const [rows] = await pool.query(
    `SELECT id, ean, fonte, imagem_url FROM catalogo_produto
      WHERE imagem_url IS NOT NULL AND imagem_url <> '' AND ean IS NOT NULL AND ean <> '' AND vetor_em IS NULL
      ORDER BY id LIMIT ?`, [LOTE]);
  if (!rows.length) break;
  // baixar (paralelo controlado)
  const baixados = [];
  await Promise.all(rows.map(async (r) => { if (await baixar(r.imagem_url, `${IMG_DIR}/${r.id}.jpg`)) baixados.push(r); }));
  if (!baixados.length) { falhas += rows.length; await pool.query('UPDATE catalogo_produto SET foto_em=NOW() WHERE id IN (?)', [rows.map((r) => r.id)]); continue; }
  // vetorizar
  const er = await j(`${INFER}/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: baixados.map((r) => r.id) }) });
  const points = [];
  for (const it of er.itens) {
    if (!it.vec) continue;
    const r = baixados.find((x) => x.id === it.id);
    points.push({ id: it.id, vector: it.vec, payload: { ean: r.ean, fonte: r.fonte } });
  }
  if (points.length) await fetch(`${QDRANT}/collections/${COLECCAO}/points?wait=true`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points }) });
  const ok = points.map((p) => p.id);
  if (ok.length) await pool.query('UPDATE catalogo_produto SET foto_em=NOW(), vetor_em=NOW() WHERE id IN (?)', [ok]);
  total += ok.length;
  const rps = total / ((Date.now() - t0) / 1000);
  process.stdout.write(`\r  vetorizadas ${total} · ${rps.toFixed(1)}/s · falhas ${falhas}   `);
}
console.log(`\nconcluído: ${total} vetorizadas, ${falhas} falhas de download`);
process.exit(0);

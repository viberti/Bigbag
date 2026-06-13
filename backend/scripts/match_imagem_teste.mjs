// Diagnóstico do match por imagem: pega uma foto JÁ vetorizada (ou um id dado),
// re-vetoriza-a e mostra os top-k vizinhos por EAN. Self-match deve dar o próprio
// EAN em score ~1,0; os seguintes mostram os parecidos. Valida o pipeline
// inferência→Qdrant end-to-end.
//   sudo -u dev node --env-file=.env scripts/match_imagem_teste.mjs [id]
import { readFile } from 'node:fs/promises';
import { getPool } from '../src/db.js';
import { matchImagemB64, estadoMatchImagem } from '../src/normaliza/matchImagem.js';

const IMG_DIR = process.env.IMG_DIR || '/var/lib/bigbag/imagens';
console.log('estado:', JSON.stringify(await estadoMatchImagem()));

const pool = getPool();
const idArg = process.argv[2];
const [[row]] = idArg
  ? await pool.query('SELECT id, ean, nome, fonte FROM catalogo_produto WHERE id = ?', [idArg])
  : await pool.query('SELECT id, ean, nome, fonte FROM catalogo_produto WHERE vetor_em IS NOT NULL ORDER BY id LIMIT 1');
if (!row) { console.log('sem foto vetorizada ainda'); process.exit(0); }

const b64 = (await readFile(`${IMG_DIR}/${row.id}.jpg`)).toString('base64');
console.log(`\nquery: id ${row.id} · EAN ${row.ean} · ${row.nome} (${row.fonte})`);
const t0 = Date.now();
const cands = await matchImagemB64(b64, { k: 8 });
console.log(`match em ${Date.now() - t0}ms:`);
for (const c of cands.slice(0, 6)) {
  const [[p]] = await pool.query('SELECT nome, fonte FROM catalogo_produto WHERE ean = ? LIMIT 1', [c.ean]);
  const marca = c.ean === row.ean ? '  ← ELE PRÓPRIO' : '';
  console.log(`  ${c.score.toFixed(3)}  EAN ${c.ean}  ${(p?.nome || '?').slice(0, 44)}${marca}`);
}
process.exit(0);

// Mede o efeito do pré-processamento de imagem: para cada foto de fatura,
// extrai com flash a imagem CRUA vs a PROCESSADA, comparando tamanho e
// discrepância de reconciliação. Sem persistir.
//   node scripts/comparar_preproc.mjs
import { getPool, closePool } from '../src/db.js';
import { extrairFatura } from '../src/ingest/extract.js';
import { preProcessarImagem } from '../src/ingest/imagem.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { readFile } from 'node:fs/promises';

const MODELO = 'google/gemini-2.5-flash';
const pool = getPool();
const [fats] = await pool.query(
  "SELECT id, ficheiro_original AS f, total_impresso AS tot FROM fatura WHERE metodo_extracao='vlm' AND ficheiro_original LIKE '%.jpg' ORDER BY id",
);

async function ler(b64) {
  const d = await extrairFatura({ imageBase64: b64, mime: 'image/jpeg', model: MODELO });
  const rec = distribuirDesconto(d.itens, { descontoGlobal: Number(d.desconto_global) || 0, totalImpresso: d.total_impresso });
  return { itens: d.itens.length, disc: rec.discrepancia, bate: rec.extracaoBate };
}

let bytesRaw = 0, bytesProc = 0, bateRaw = 0, bateProc = 0, n = 0;
for (const fa of fats) {
  let buf;
  try {
    buf = await readFile(fa.f);
  } catch {
    continue;
  }
  const { buffer: proc } = await preProcessarImagem(buf);
  bytesRaw += buf.length;
  bytesProc += proc.length;
  n++;
  try {
    const r = await ler(buf.toString('base64'));
    const p = await ler(proc.toString('base64'));
    if (r.bate) bateRaw++;
    if (p.bate) bateProc++;
    console.log(
      `#${fa.id} ${Math.round(buf.length / 1024)}KB→${Math.round(proc.length / 1024)}KB | crua: itens=${r.itens} disc=${r.disc} ${r.bate ? 'OK' : 'XX'} | proc: itens=${p.itens} disc=${p.disc} ${p.bate ? 'OK' : 'XX'}`,
    );
  } catch (e) {
    console.log(`#${fa.id} ERRO ${e.message.slice(0, 40)}`);
  }
}
console.log(
  `\nTamanho total: ${(bytesRaw / 1048576).toFixed(1)}MB → ${(bytesProc / 1048576).toFixed(1)}MB (${Math.round(100 * (1 - bytesProc / bytesRaw))}% menor)`,
);
console.log(`Reconciliam: CRUA ${bateRaw}/${n} · PROCESSADA ${bateProc}/${n}`);
await closePool();

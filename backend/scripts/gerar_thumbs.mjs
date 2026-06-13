// LOTE: gera as miniaturas normalizadas (recorte da moldura + quadrado) de TODAS
// as imagens de catálogo em disco. Reentrante (salta as que já existem). Gentil
// com o host (concorrência baixa — corre no servidor partilhado).
//   sudo -u dev node --env-file=.env scripts/gerar_thumbs.mjs [--forcar]
import { readdirSync } from 'node:fs';
import sharp from 'sharp';
import { gerarThumbCatalogo, IMG_DIR } from '../src/ingest/thumbCatalogo.js';

sharp.concurrency(1); // não monopolizar os núcleos (pitacos.ai/1417 partilham o host)
const forcar = process.argv.includes('--forcar');
const LOTE = 4;

const ids = readdirSync(IMG_DIR)
  .filter((f) => f.endsWith('.jpg'))
  .map((f) => Number(f.slice(0, -4)))
  .filter((n) => Number.isInteger(n) && n > 0);
console.log(`imagens em disco: ${ids.length}${forcar ? ' · MODO FORÇAR' : ''}`);

let ok = 0, falhas = 0;
const t0 = Date.now();
for (let i = 0; i < ids.length; i += LOTE) {
  const lote = ids.slice(i, i + LOTE);
  const res = await Promise.all(lote.map((id) => gerarThumbCatalogo(id, { forcar }).then((d) => !!d).catch(() => false)));
  for (const r of res) (r ? ok++ : falhas++);
  if (i % 1000 < LOTE) {
    const rps = (ok + falhas) / ((Date.now() - t0) / 1000);
    process.stdout.write(`\r  ${ok + falhas}/${ids.length} · ok ${ok} · falhas ${falhas} · ${rps.toFixed(0)}/s   `);
  }
}
console.log(`\nconcluído: ${ok} miniaturas, ${falhas} falhas`);
process.exit(0);

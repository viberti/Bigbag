// Isola o efeito do CINZA: mesma imagem (mesmo resize + contraste), COLORIDA vs
// TONS DE CINZA, extraída com flash. Compara a discrepância de reconciliação.
import { getPool, closePool } from '../src/db.js';
import { extrairFatura } from '../src/ingest/extract.js';
import { preProcessarImagem } from '../src/ingest/imagem.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { readFile } from 'node:fs/promises';

const MODELO = 'google/gemini-2.5-flash';
const pool = getPool();
const [fats] = await pool.query(
  "SELECT id, ficheiro_original AS f FROM fatura WHERE metodo_extracao='vlm' AND ficheiro_original LIKE '%.jpg' ORDER BY id",
);
const reconciliar = (d) => distribuirDesconto(d.itens, { descontoGlobal: Number(d.desconto_global) || 0, totalImpresso: d.total_impresso });

async function ler(buffer) {
  const d = await extrairFatura({ imageBase64: buffer.toString('base64'), mime: 'image/jpeg', model: MODELO });
  const rec = reconciliar(d);
  return { itens: d.itens.length, disc: rec.discrepancia, bate: rec.extracaoBate, kb: Math.round(buffer.length / 1024) };
}

let bateCor = 0, bateCinza = 0, n = 0;
for (const fa of fats) {
  let buf;
  try {
    buf = await readFile(fa.f);
  } catch {
    continue;
  }
  const cor = (await preProcessarImagem(buf, { cinza: false })).buffer;
  const cinza = (await preProcessarImagem(buf, { cinza: true })).buffer;
  try {
    const c = await ler(cor);
    const g = await ler(cinza);
    n++;
    if (c.bate) bateCor++;
    if (g.bate) bateCinza++;
    console.log(
      `#${fa.id} | cor(${c.kb}KB): itens=${c.itens} disc=${c.disc} ${c.bate ? 'OK' : 'XX'} | cinza(${g.kb}KB): itens=${g.itens} disc=${g.disc} ${g.bate ? 'OK' : 'XX'}`,
    );
  } catch (e) {
    console.log(`#${fa.id} ERRO ${e.message.slice(0, 30)}`);
  }
}
console.log(`\nReconciliam: COLORIDA ${bateCor}/${n} · CINZA ${bateCinza}/${n}`);
await closePool();

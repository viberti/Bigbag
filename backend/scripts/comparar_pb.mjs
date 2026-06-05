// A/B: COLORIDA (atual) vs PRETO-E-BRANCO puro (binarização) enviada ao modelo.
// Mede a discrepância de reconciliação. Não persiste.
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

async function ler({ buffer, mime }) {
  const d = await extrairFatura({ imageBase64: buffer.toString('base64'), mime, model: MODELO });
  const rec = reconciliar(d);
  return { itens: d.itens.length, disc: rec.discrepancia, bate: rec.extracaoBate, kb: Math.round(buffer.length / 1024) };
}

let bateCor = 0, batePb = 0, n = 0;
for (const fa of fats) {
  let buf;
  try {
    buf = await readFile(fa.f);
  } catch {
    continue;
  }
  const cor = await preProcessarImagem(buf, { cinza: false });
  const pb = await preProcessarImagem(buf, { pb: true });
  try {
    const c = await ler(cor);
    const p = await ler(pb);
    n++;
    if (c.bate) bateCor++;
    if (p.bate) batePb++;
    console.log(
      `#${fa.id} | cor(${c.kb}KB): itens=${c.itens} disc=${c.disc} ${c.bate ? 'OK' : 'XX'} | pb(${p.kb}KB): itens=${p.itens} disc=${p.disc} ${p.bate ? 'OK' : 'XX'}`,
    );
  } catch (e) {
    console.log(`#${fa.id} ERRO ${e.message.slice(0, 30)}`);
  }
}
console.log(`\nReconciliam: COLORIDA ${bateCor}/${n} · PRETO-E-BRANCO ${batePb}/${n}`);
await closePool();

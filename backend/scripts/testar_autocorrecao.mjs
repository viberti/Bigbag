// Mede o efeito da auto-correção: corre o pipeline (preproc + extração) em todas
// as imagens; quando não fecha, realimenta a discrepância e re-extrai. Compara a
// taxa de reconciliação SEM vs COM auto-correção. Não persiste.
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
const reconciliar = (d) => distribuirDesconto(d.itens, { descontoGlobal: Number(d.desconto_global) || 0, totalImpresso: d.total_impresso });

let semCorr = 0, comCorr = 0, n = 0;
for (const fa of fats) {
  let buf;
  try {
    buf = await readFile(fa.f);
  } catch {
    continue;
  }
  const { buffer, mime } = await preProcessarImagem(buf);
  const b64 = buffer.toString('base64');
  let dados = await extrairFatura({ imageBase64: b64, mime, model: MODELO });
  let rec = reconciliar(dados);
  const disc1 = rec.discrepancia, bate1 = rec.extracaoBate;
  let nota = '';
  if (!bate1 && dados.total_impresso != null) {
    const hint = `A soma dos itens deu ${rec.subtotal} mas o total impresso é ${dados.total_impresso} (diferença ${rec.discrepancia}). Reverifica: itens a peso (preço impresso, não kg×€/kg), descontos, itens em falta/a mais. Devolve o JSON corrigido.`;
    try {
      const d2 = await extrairFatura({ imageBase64: b64, mime, model: MODELO, correcao: hint });
      const r2 = reconciliar(d2);
      if (Math.abs(r2.discrepancia) < Math.abs(rec.discrepancia)) {
        rec = r2;
        dados = d2;
      }
      nota = ` → corr disc=${rec.discrepancia} ${rec.extracaoBate ? 'OK' : 'XX'}`;
    } catch {
      nota = ' → corr ERRO';
    }
  }
  n++;
  if (bate1) semCorr++;
  if (rec.extracaoBate) comCorr++;
  console.log(`#${fa.id} sem disc=${disc1} ${bate1 ? 'OK' : 'XX'}${nota}`);
}
console.log(`\nReconciliam: SEM auto-correção ${semCorr}/${n} · COM ${comCorr}/${n}`);
await closePool();

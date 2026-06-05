// A/B de qualidade de leitura de fatura: corre flash vs flash-lite nas MESMAS
// imagens já guardadas, sem persistir. Mede a discrepância de reconciliação
// (sinal objetivo) e regista o custo (contexto extracao_imagem) em custo_chamada.
//   node scripts/comparar_modelos.mjs [N]
import { getPool, closePool } from '../src/db.js';
import { extrairFatura } from '../src/ingest/extract.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { readFile } from 'node:fs/promises';

const N = Number(process.argv[2]) || 8;
const MODELOS = ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'];
const pool = getPool();

const [fats] = await pool.query(
  "SELECT id, ficheiro_original, total_impresso FROM fatura WHERE metodo_extracao='vlm' AND ficheiro_original LIKE '%.jpg' ORDER BY id DESC LIMIT ?",
  [N],
);

const placar = {}; // por modelo: {bate, total, somaDisc}
for (const m of MODELOS) placar[m] = { bate: 0, total: 0, somaDisc: 0 };

for (const f of fats) {
  let buf;
  try {
    buf = await readFile(f.ficheiro_original);
  } catch {
    continue;
  }
  const b64 = buf.toString('base64');
  const cols = [`#${f.id} (BD tot ${f.total_impresso})`];
  for (const m of MODELOS) {
    try {
      const dados = await extrairFatura({ imageBase64: b64, mime: 'image/jpeg', model: m });
      const rec = distribuirDesconto(dados.itens, {
        descontoGlobal: Number(dados.desconto_global) || 0,
        totalImpresso: dados.total_impresso,
      });
      placar[m].total++;
      placar[m].somaDisc += Math.abs(rec.discrepancia);
      if (rec.extracaoBate) placar[m].bate++;
      const tag = m.split('/')[1].replace('gemini-2.5-', '');
      cols.push(`${tag}: tot=${dados.total_impresso} itens=${dados.itens.length} disc=${rec.discrepancia} ${rec.extracaoBate ? 'OK' : 'XX'}`);
    } catch (e) {
      cols.push(`${m.split('/')[1]}: ERRO ${e.message.slice(0, 30)}`);
    }
  }
  console.log(cols.join(' | '));
}

console.log('\n=== RESUMO ===');
for (const m of MODELOS) {
  const p = placar[m];
  console.log(
    `${m}: reconciliam ${p.bate}/${p.total} (${p.total ? Math.round((100 * p.bate) / p.total) : 0}%) · disc média ${(p.total ? p.somaDisc / p.total : 0).toFixed(3)}`,
  );
}
await closePool();

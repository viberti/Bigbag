// A/B de qualidade de leitura: flash vs flash-lite em TODAS as faturas
// armazenadas, sem persistir. Imagens (VLM) e PDFs (texto). Mede a discrepância
// de reconciliação (sinal objetivo) e regista custo em custo_chamada.
//   node scripts/comparar_modelos.mjs
import { getPool, closePool } from '../src/db.js';
import { extrairFatura, extrairFaturaDeTexto } from '../src/ingest/extract.js';
import { extrairTextoPdf } from '../src/ingest/pdf.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { readFile } from 'node:fs/promises';

const MODELOS = ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'];
const pool = getPool();

const [fats] = await pool.query(
  "SELECT id, ficheiro_original AS f, total_impresso AS tot, metodo_extracao AS m FROM fatura WHERE ficheiro_original IS NOT NULL ORDER BY id",
);

// placar[modelo][tipo] = {bate, total, somaDisc, erros}
const placar = {};
for (const m of MODELOS) placar[m] = { imagem: novo(), pdf: novo() };
function novo() {
  return { bate: 0, total: 0, somaDisc: 0, erros: 0 };
}

for (const fa of fats) {
  let buf;
  try {
    buf = await readFile(fa.f);
  } catch {
    continue;
  }
  const ehPdf = /\.pdf$/i.test(fa.f);
  const tipo = ehPdf ? 'pdf' : 'imagem';
  const cols = [`#${fa.id} ${tipo[0]} (tot ${fa.tot})`];
  for (const m of MODELOS) {
    const acc = placar[m][tipo];
    try {
      let dados;
      if (ehPdf) dados = await extrairFaturaDeTexto(await extrairTextoPdf(buf), { model: m });
      else dados = await extrairFatura({ imageBase64: buf.toString('base64'), mime: 'image/jpeg', model: m });
      const rec = distribuirDesconto(dados.itens, {
        descontoGlobal: Number(dados.desconto_global) || 0,
        totalImpresso: dados.total_impresso,
      });
      acc.total++;
      acc.somaDisc += Math.abs(rec.discrepancia);
      if (rec.extracaoBate) acc.bate++;
      const tag = m.split('/')[1].replace('gemini-2.5-', '');
      cols.push(`${tag}: itens=${dados.itens.length} disc=${rec.discrepancia} ${rec.extracaoBate ? 'OK' : 'XX'}`);
    } catch (e) {
      acc.erros++;
      cols.push(`${m.split('/')[1].replace('gemini-2.5-', '')}: ERRO`);
    }
  }
  console.log(cols.join(' | '));
}

console.log('\n=== RESUMO (reconciliam / total · disc média · erros) ===');
for (const m of MODELOS) {
  for (const tipo of ['imagem', 'pdf']) {
    const p = placar[m][tipo];
    if (!p.total && !p.erros) continue;
    const pct = p.total ? Math.round((100 * p.bate) / p.total) : 0;
    console.log(
      `${m.split('/')[1].padEnd(22)} ${tipo.padEnd(7)}: ${p.bate}/${p.total} (${pct}%) · disc ${(p.total ? p.somaDisc / p.total : 0).toFixed(3)} · erros ${p.erros}`,
    );
  }
}
await closePool();

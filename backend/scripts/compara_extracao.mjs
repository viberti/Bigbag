// Head-to-head VLM vs OCR+LLM sobre a MESMA nota (fecha a Decisão nº 2 de forma
// justa — o painel do /admin compara método-vs-tipo-de-input; aqui isola o
// método correndo os DOIS sobre o mesmo PDF de origem).
//   Método B (OCR+LLM): texto do PDF (unpdf) → LLM de texto  [pipeline atual de PDF]
//   Método A (VLM):      o MESMO PDF enviado ao modelo multimodal (parte `file`,
//                        engine 'native' = o modelo "vê" o PDF)
// Usa o PROMPT e o parser EXATOS da ingestão. Não grava nada — só compara e imprime.
//   uso: node scripts/compara_extracao.mjs [limite]
import { getPool, closePool } from '../src/db.js';
import { config } from '../src/config.js';
import { extrairTextoPdf } from '../src/ingest/pdf.js';
import { extrairFaturaDeTexto, PROMPT_EXTRACAO, parseJsonLoose } from '../src/ingest/extract.js';
import { normalizarItens } from '../src/ingest/normalize.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { readFile } from 'node:fs/promises';

const limite = Number(process.argv[2]) || 999;
const recon = (d) =>
  distribuirDesconto(d.itens, { descontoGlobal: Number(d.desconto_global) || 0, totalImpresso: d.total_impresso });

// Método A — VLM diretamente sobre o PDF (OpenRouter, parte `file` + file-parser
// native). Chamada direta para poder passar `plugins` (o cliente normal não o faz).
async function extrairPdfVLM(pdfBase64) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
    body: JSON.stringify({
      model: config.openrouter.modelExtracao,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT_EXTRACAO },
            { type: 'file', file: { filename: 'fatura.pdf', file_data: `data:application/pdf;base64,${pdfBase64}` } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
      usage: { include: true },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  const dados = parseJsonLoose(data.choices?.[0]?.message?.content ?? '');
  if (!dados || !Array.isArray(dados.itens)) throw new Error('VLM-PDF sem itens válidos');
  dados.itens = normalizarItens(dados.itens);
  return dados;
}

const pool = getPool();
const [pdfs] = await pool.query(
  "SELECT f.id, l.cadeia, f.total_impresso t, f.ficheiro_original ff FROM fatura f JOIN loja l ON l.id=f.loja_id WHERE f.metodo_extracao='ocr_llm' AND f.ficheiro_original LIKE '%.pdf' ORDER BY f.id DESC LIMIT ?",
  [limite],
);
console.log(`Comparando ${pdfs.length} PDFs (B=OCR+LLM no texto, A=VLM no mesmo PDF)\n`);

const ag = { n: 0, okB: 0, okA: 0, somaB: 0, somaA: 0, concordamTotal: 0, concordamItens: 0, erroA: 0, erroB: 0 };
console.log('#id   loja         total   | B disc  itens | A disc  itens | nota');
console.log('─'.repeat(78));
for (const p of pdfs) {
  let B, A, recB, recA, eB = '', eA = '';
  const buf = await readFile(p.ff).catch(() => null);
  if (!buf) { console.log(`#${p.id} ficheiro em falta`); continue; }
  const b64 = buf.toString('base64');
  try { B = await extrairFaturaDeTexto(await extrairTextoPdf(buf)); recB = recon(B); } catch (e) { eB = e.message; ag.erroB++; }
  try { A = await extrairPdfVLM(b64); recA = recon(A); } catch (e) { eA = e.message; ag.erroA++; }

  ag.n++;
  const fmt = (rec, e) => (e ? 'ERRO'.padEnd(12) : `${(rec.discrepancia >= 0 ? '+' : '') + rec.discrepancia.toFixed(2)}`.padStart(6) + ` ${String(rec.itens.length).padStart(2)}`.padEnd(6));
  let nota = '';
  if (recB && recA) {
    if (recB.extracaoBate) ag.okB++;
    if (recA.extracaoBate) ag.okA++;
    ag.somaB += Math.abs(recB.discrepancia);
    ag.somaA += Math.abs(recA.discrepancia);
    const tB = B.total_impresso, tA = A.total_impresso;
    if (Math.abs(Number(tB) - Number(tA)) < 0.015) ag.concordamTotal++; else nota += ` totais≠ (B=${tB} A=${tA})`;
    if (recB.itens.length === recA.itens.length) ag.concordamItens++; else nota += ` itens≠`;
    if (recB.extracaoBate && !recA.extracaoBate) nota += ' ◀B bate, A não';
    if (recA.extracaoBate && !recB.extracaoBate) nota += ' ▶A bate, B não';
  }
  console.log(
    `#${String(p.id).padEnd(4)} ${(p.cadeia || '').slice(0, 11).padEnd(11)} ${String(p.t).padStart(7)} | ${fmt(recB, eB)} | ${fmt(recA, eA)} |${nota}${eA ? ' A:' + eA.slice(0, 40) : ''}${eB ? ' B:' + eB.slice(0, 40) : ''}`,
  );
}
console.log('─'.repeat(78));
console.log(
  `\nAGREGADO (${ag.n} notas):\n` +
    `  reconciliam:  B(OCR+LLM) ${ag.okB}/${ag.n}   A(VLM) ${ag.okA}/${ag.n}\n` +
    `  |disc| média: B ${(ag.somaB / Math.max(1, ag.n - ag.erroB)).toFixed(3)}   A ${(ag.somaA / Math.max(1, ag.n - ag.erroA)).toFixed(3)}\n` +
    `  concordam no total: ${ag.concordamTotal}/${ag.n}   no nº de itens: ${ag.concordamItens}/${ag.n}\n` +
    `  erros: A ${ag.erroA}   B ${ag.erroB}`,
);
await closePool();

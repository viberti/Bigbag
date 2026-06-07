// Compara VLMs na extração de talões (imagens). Mesma imagem → N modelos.
// Mede: reconciliação (Σitens−desc≈total do modelo), |disc|, acerto do total e
// nº de itens vs. o valor GUARDADO (verdade pós-reset), e CUSTO (usage.cost).
import { getPool, closePool } from '../src/db.js';
import { config } from '../src/config.js';
import { preProcessarImagem } from '../src/ingest/imagem.js';
import { PROMPT_EXTRACAO, parseJsonLoose } from '../src/ingest/extract.js';
import { normalizarItens } from '../src/ingest/normalize.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { readFile } from 'node:fs/promises';

const MODELOS = [
  'qwen/qwen3.5-flash-02-23',
  'google/gemini-2.5-flash-lite',
  'google/gemini-3.1-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-3-flash-preview',
];
const LIMITE = Number(process.argv[2]) || 12;
const recon = (d) => distribuirDesconto(d.itens, { descontoGlobal: Number(d.desconto_global) || 0, totalImpresso: d.total_impresso });

async function extrair(modelo, imageBase64, mime) {
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
    body: JSON.stringify({
      model: modelo,
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT_EXTRACAO },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
      ] }],
      response_format: { type: 'json_object' },
      usage: { include: true },
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(()=>'')).slice(0,120)}`);
  const data = await res.json();
  const dados = parseJsonLoose(data.choices?.[0]?.message?.content ?? '');
  if (!dados || !Array.isArray(dados.itens)) throw new Error('sem itens válidos');
  dados.itens = normalizarItens(dados.itens);
  return { dados, custo: Number(data.usage?.cost) || 0, ms };
}

const pool = getPool();
const [imgs] = await pool.query(
  `SELECT f.id, l.cadeia, f.total_impresso t, f.ficheiro_original ff,
          (SELECT COUNT(*) FROM item i WHERE i.fatura_id=f.id) ni
     FROM fatura f JOIN loja l ON l.id=f.loja_id
    WHERE f.metodo_extracao='vlm' AND f.ficheiro_original LIKE '%.jpg' AND f.total_impresso IS NOT NULL
    ORDER BY l.cadeia, f.id LIMIT ?`, [LIMITE]);
console.log(`Comparando ${MODELOS.length} VLMs em ${imgs.length} imagens\n`);

const ag = {}; for (const m of MODELOS) ag[m] = { recon: 0, somaDisc: 0, totOk: 0, itOk: 0, custo: 0, ms: 0, err: 0, n: 0 };
for (const p of imgs) {
  const buf = await readFile(p.ff).catch(() => null);
  if (!buf) { console.log(`#${p.id} ficheiro em falta`); continue; }
  const img = await preProcessarImagem(buf);
  const b64 = img.buffer.toString('base64');
  console.log(`#${p.id} ${p.cadeia} (guardado: total ${p.t}€, ${p.ni} itens)`);
  for (const m of MODELOS) {
    const a = ag[m]; a.n++;
    try {
      const { dados, custo, ms } = await extrair(m, b64, img.mime);
      const r = recon(dados);
      a.somaDisc += Math.abs(r.discrepancia); a.custo += custo; a.ms += ms;
      const bate = r.extracaoBate; if (bate) a.recon++;
      const totOk = Math.abs(Number(dados.total_impresso) - Number(p.t)) < 0.02; if (totOk) a.totOk++;
      const itOk = r.itens.length === p.ni; if (itOk) a.itOk++;
      console.log(`   ${m.split('/')[1].padEnd(26)} ${bate?'✓bate':'✗    '} disc ${r.discrepancia.toFixed(2).padStart(6)} | total ${totOk?'✓':'✗'} itens ${r.itens.length}${itOk?'=':'≠'}${p.ni} | $${custo.toFixed(5)} ${ms}ms`);
    } catch (e) { a.err++; console.log(`   ${m.split('/')[1].padEnd(26)} ERRO: ${e.message}`); }
  }
}
console.log('\n=== AGREGADO ===');
console.log('modelo'.padEnd(28)+'reconcilia  total-ok  itens-ok  |disc|méd  custo/nota  $/100notas  err');
for (const m of MODELOS) {
  const a = ag[m], v = Math.max(1, a.n - a.err);
  console.log(
    m.split('/')[1].padEnd(28) +
    `${a.recon}/${a.n}`.padEnd(12) + `${a.totOk}/${a.n}`.padEnd(10) + `${a.itOk}/${a.n}`.padEnd(10) +
    (a.somaDisc/v).toFixed(3).padEnd(11) + ('$'+(a.custo/v).toFixed(5)).padEnd(12) +
    ('$'+(a.custo/v*100).toFixed(2)).padEnd(12) + a.err);
}
await closePool(); process.exit(0);

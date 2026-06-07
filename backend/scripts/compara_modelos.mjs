// Head-to-head de MODELOS de extração por imagem (mesmo prompt + parser da
// produção). Mede sinais objetivos: reconciliação, total lido certo, nº de itens
// vs BD, captura de peso/formato, custo real (usage.cost) e latência.
// Não altera dados — só lê ficheiros e chama os modelos. Escreve artefactos.
import { readFile, writeFile } from 'node:fs/promises';
import { getPool } from '../src/db.js';
import { preProcessarImagem } from '../src/ingest/imagem.js';
import { PROMPT_EXTRACAO, parseJsonLoose } from '../src/ingest/extract.js';
import { normalizarItens } from '../src/ingest/normalize.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { extrairFormato } from '../src/normaliza/formato.js';
import { config } from '../src/config.js';

const MODELS = [
  'google/gemini-2.5-flash', // baseline atual
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-opus-4.8',
  'x-ai/grok-4.3',
  'openai/gpt-5.5',
];
const IDS = [241, 240, 216, 201, 198, 192, 140, 139, 131, 191];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const reconc = (d) => distribuirDesconto(d.itens || [], { descontoGlobal: num(d.desconto_global) || 0, totalImpresso: d.total_impresso, iva: num(d.iva) || 0 });
const aprox = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= 0.02;
const temPeso = (it) => {
  const f = extrairFormato(String(it.descricao_original || ''));
  return f.unidade_base === 'kg' || f.unidade_base === 'L';
};

async function chama(model, b64, mime) {
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://bigbag.hal9klabs.com', 'X-Title': 'Bigbag' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT_EXTRACAO }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }],
      usage: { include: true },
    }),
  });
  const data = await res.json();
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + JSON.stringify(data).slice(0, 160));
  return { txt: data.choices?.[0]?.message?.content ?? '', cost: Number(data.usage?.cost) || 0, ms };
}

const db = getPool();
const recibos = [];
for (const id of IDS) {
  const [[f]] = await db.query('SELECT f.ficheiro_original, f.total_impresso, l.cadeia FROM fatura f JOIN loja l ON l.id=f.loja_id WHERE f.id=?', [id]);
  const [[c]] = await db.query('SELECT COUNT(*) n FROM item WHERE fatura_id=? AND is_non_product=0', [id]);
  const img = await preProcessarImagem(await readFile(f.ficheiro_original));
  recibos.push({ id, cadeia: f.cadeia, total: Number(f.total_impresso), n_bd: c.n, b64: img.buffer.toString('base64'), mime: img.mime });
}
console.log('recibos carregados:', recibos.length, '| modelos:', MODELS.length, '\n');

const out = {};
for (const model of MODELS) {
  const rows = [];
  for (const r of recibos) {
    let row = { id: r.id, cadeia: r.cadeia, total_bd: r.total, n_bd: r.n_bd };
    try {
      const { txt, cost, ms } = await chama(model, r.b64, r.mime);
      const d = parseJsonLoose(txt);
      d.itens = normalizarItens(d.itens || []);
      const reais = d.itens.filter((it) => !it.is_non_product);
      const rec = reconc(d);
      row = { ...row, n: reais.length, tot: num(d.total_impresso), tot_ok: aprox(d.total_impresso, r.total), disc: rec.discrepancia, recon: !!rec.extracaoBate, pesos: reais.filter(temPeso).length, cost, ms, itens: reais.map((it) => ({ d: it.descricao_original, v: it.valor ?? it.preco_liquido })) };
    } catch (e) {
      row = { ...row, erro: String(e.message || e).slice(0, 140) };
    }
    rows.push(row);
    process.stdout.write(row.erro ? 'E' : row.recon ? '.' : 'x');
  }
  out[model] = rows;
  process.stdout.write(' << ' + model + '\n');
}
await db.end();

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '?');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '?');
console.log('\n================ RESUMO (n=' + recibos.length + ') ================');
console.log('modelo'.padEnd(34), 'recon', 'totOK', 'itens=BD', '|disc|', 'pesos', '$/rec', 'seg');
for (const model of MODELS) {
  const rows = out[model];
  const ok = rows.filter((r) => r.recon).length;
  const totok = rows.filter((r) => r.tot_ok).length;
  const imatch = rows.filter((r) => r.n === r.n_bd).length;
  const errs = rows.filter((r) => r.erro).length;
  const disc = rows.filter((r) => Number.isFinite(r.disc)).map((r) => Math.abs(r.disc));
  const pesos = rows.reduce((s, r) => s + (r.pesos || 0), 0);
  const cost = rows.reduce((s, r) => s + (r.cost || 0), 0) / rows.length;
  const seg = rows.reduce((s, r) => s + (r.ms || 0), 0) / rows.length / 1000;
  const discAvg = disc.length ? disc.reduce((a, b) => a + b, 0) / disc.length : NaN;
  console.log(model.padEnd(34), (ok + '/' + rows.length).padEnd(5), (totok + '/' + rows.length).padEnd(5), (imatch + '/' + rows.length).padEnd(8), f3(discAvg).padEnd(6), String(pesos).padEnd(5), f3(cost).padEnd(6), f1(seg) + (errs ? '  (' + errs + ' err)' : ''));
}
await writeFile('scripts/_modelos_resultados.json', JSON.stringify(out, null, 2));
console.log('\nartefactos → backend/scripts/_modelos_resultados.json');

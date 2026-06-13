// CALIBRAÇÃO v2 — match cross-loja PD→catálogo-com-EAN COM METADADOS. A imagem gera
// candidatos; MARCA (gate) + PESO (discriminador) + nome distintivo confirmam. Sem
// ground-truth de EAN, a validação é a CONJUNÇÃO de sinais independentes (aparência
// + string de marca + número de peso não coincidem por acaso em produtos diferentes).
//   sudo -u dev node --env-file=.env scripts/calibrar_pd2.mjs [--n=300]
import { getPool } from '../src/db.js';
import { matchPorVetor } from '../src/normaliza/matchImagem.js';
import { normAlfa } from '../src/normaliza/categoria.js';

const INFER = process.env.INFER_URL || 'http://localhost:8900';
const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1]) || 300;
const LOTE = 16;
const pool = getPool();

const [pds] = await pool.query(
  `SELECT id, nome, marca, formato_valor fval, unidade_base ubase, imagem_url
     FROM catalogo_produto
    WHERE fonte='pingodoce' AND imagem_url<>'' AND imagem_url IS NOT NULL AND nome IS NOT NULL
    ORDER BY RAND() LIMIT ?`, [N]);

const baixar = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch { return null; }
};
const itens = [];
for (let i = 0; i < pds.length; i += 8) {
  const lote = pds.slice(i, i + 8);
  const b = await Promise.all(lote.map((x) => baixar(x.imagem_url)));
  lote.forEach((x, j) => { if (b[j]) itens.push({ ...x, b64: b[j] }); });
  process.stderr.write(`\r  baixadas ${itens.length}`);
}
console.error(`\n  ${itens.length} imagens`);

// imagem → top-5 candidatos
const comCands = [];
for (let i = 0; i < itens.length; i += LOTE) {
  const lote = itens.slice(i, i + LOTE);
  const r = await fetch(`${INFER}/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b64: lote.map((x) => x.b64) }) });
  const d = await r.json();
  for (let j = 0; j < lote.length; j++) {
    const vec = d.itens?.[j]?.vec; if (!vec) continue;
    const cands = await matchPorVetor(vec, { k: 5 });
    if (cands.length) comCands.push({ pd: lote[j], cands });
  }
  process.stderr.write(`\r  match ${Math.min(i + LOTE, itens.length)}/${itens.length}`);
}
console.error('');

// metadados de TODOS os candidatos (por id de catálogo = id do ponto)
const ids = [...new Set(comCands.flatMap((x) => x.cands.map((c) => c.id)))];
const byId = new Map();
for (let i = 0; i < ids.length; i += 500) {
  const ch = ids.slice(i, i + 500);
  const [rows] = await pool.query(`SELECT id, nome, marca, formato_valor fval, unidade_base ubase, fonte FROM catalogo_produto WHERE id IN (${ch.map(() => '?').join(',')})`, ch);
  for (const x of rows) byId.set(x.id, x);
}

const nm = (s) => normAlfa(s || '');
// marca por TOKENS (não substring): "Garnier Ultra Suave" == "Ultra Suave Garnier"
// (mesma marca, ordem diferente). Partilham ≥1 token significativo → mesma marca;
// ambas com tokens mas zero em comum → conflito; alguma vazia → desconhecido.
const marcaEstado = (a, b) => {
  const A = new Set(nm(a).split(' ').filter((t) => t.length >= 3));
  const B = new Set(nm(b).split(' ').filter((t) => t.length >= 3));
  if (!A.size || !B.size) return 'desc';
  for (const t of A) if (B.has(t)) return 'igual';
  return 'conflito';
};
const pesoEstado = (pf, pu, cf, cu) => {
  if (pf == null || cf == null || !pu || !cu) return 'desc';
  if (nm(pu) !== nm(cu)) return 'difere';
  const a = Number(pf), b = Number(cf); if (!(a > 0) || !(b > 0)) return 'desc';
  return Math.abs(a - b) / Math.max(a, b) <= 0.06 ? 'igual' : 'difere';
};
const toks = (s) => new Set(nm(s).split(' ').filter((t) => t.length >= 4));
const nomeOv = (a, b) => { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.min(A.size, B.size); };

// para cada PD: escolhe o candidato MELHOR CORROBORADO entre os top-5
function avalia(pd, cands) {
  let best = null;
  for (const c of cands) {
    const m = byId.get(c.id); if (!m) continue;
    const marca = marcaEstado(pd.marca, m.marca);
    const peso = pesoEstado(pd.fval, pd.ubase, m.fval, m.ubase);
    const ov = nomeOv(pd.nome, m.nome);
    const rank = (marca === 'igual' ? 2 : marca === 'desc' ? 1 : 0) * 10 + (peso === 'igual' ? 2 : peso === 'desc' ? 1 : 0) * 3 + c.score;
    const cand = { m, score: c.score, marca, peso, ov, rank };
    if (!best || rank > best.rank) best = cand;
  }
  return best;
}

let auto = 0, outroTam = 0, evitado = 0, revisao = 0, descarta = 0;
const exAuto = [], exEvit = [], exTam = [];
for (const { pd, cands } of comCands) {
  const b = avalia(pd, cands);
  if (!b) { descarta++; continue; }
  const forteVis = b.score >= 0.80;
  if (b.marca === 'conflito' && forteVis) { evitado++; if (exEvit.length < 8) exEvit.push({ pd, b }); continue; }
  if (b.marca === 'igual' && b.peso === 'igual' && b.score >= 0.72) { auto++; if (exAuto.length < 10) exAuto.push({ pd, b }); continue; }
  if (b.marca === 'igual' && b.peso === 'difere' && b.score >= 0.72) { outroTam++; if (exTam.length < 6) exTam.push({ pd, b }); continue; }
  if (b.marca !== 'conflito' && b.score >= 0.85 && b.ov >= 0.5) { revisao++; continue; }
  descarta++;
}
const tot = comCands.length;
const pct = (x) => `${x} (${Math.round(100 * x / tot)}%)`;
console.log(`\n=== DECISÃO (de ${tot} PD com candidato visual) ===`);
console.log(`  AUTO-ACEITA (marca=igual & peso=igual):      ${pct(auto)}`);
console.log(`  MESMO PRODUTO, OUTRO TAMANHO (marca, peso≠):  ${pct(outroTam)}`);
console.log(`  REVISÃO (marca ok/desc, visual alto, nome):   ${pct(revisao)}`);
console.log(`  FALSO POSITIVO EVITADO (conflito de marca):   ${pct(evitado)}  ← o ganho`);
console.log(`  descartado:                                   ${pct(descarta)}`);
const yld = Math.round((auto + outroTam) / tot * 15197);
console.log(`\n  rendimento estimado p/ 15197 PD: ~${yld} ligados c/ confianca (auto + outro-tamanho)`);

const linha = ({ pd, b }) => `  vis${b.score.toFixed(2)} ov${b.ov.toFixed(2)} [${b.peso}]  ${pd.marca||'-'}|${String(pd.nome).slice(0,24)} ${pd.fval}${pd.ubase}  ->  ${b.m.marca||'-'}|${String(b.m.nome).slice(0,24)} ${b.m.fval}${b.m.ubase} [${b.m.fonte}]`;
console.log('\n=== AUTO-ACEITA (verifica) ==='); exAuto.forEach((x) => console.log(linha(x)));
console.log('\n=== FALSOS POSITIVOS EVITADOS (imagem alta, marca diferente) ==='); exEvit.forEach((x) => console.log(linha(x)));
console.log('\n=== MESMO PRODUTO OUTRO TAMANHO ==='); exTam.forEach((x) => console.log(linha(x)));
await pool.end();

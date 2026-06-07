// Head-to-head de CANONICALIZAÇÃO (Camada 2): qual modelo "reconhece" melhor o
// que cada produto é. Reusa a função de produção `canonicalizar(desc,{model,cadeia})`.
// Sinais: convergência entre modelos (proxy, não verdade), desacordo de unidade,
// confiança média. O essencial é o lado-a-lado para juízo humano.
import { writeFile } from 'node:fs/promises';
import { getPool } from '../src/db.js';
import { canonicalizar } from '../src/normaliza/canonical.js';
import { normalizarNome, similaridade } from '../src/normaliza/similaridade.js';

const MODELS = [
  ['google/gemini-2.5-flash', 'flash'],
  ['google/gemini-3.1-pro-preview', 'gem-pro'],
  ['anthropic/claude-opus-4.8', 'opus'],
  ['x-ai/grok-4.3', 'grok'],
  ['openai/gpt-5.5', 'gpt5.5'],
];

const db = getPool();
// Candidatas: descrições reais; pontua "trickiness" (abreviaturas, marca de cadeia)
const [cand] = await db.query(
  `SELECT i.descricao_original AS d, MAX(l.cadeia) AS cadeia, COUNT(*) AS n
     FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
    WHERE i.is_non_product=0 AND CHAR_LENGTH(i.descricao_original) BETWEEN 6 AND 42
    GROUP BY i.descricao_original`,
);
const ABREV = /\b(CNT|CONT|PD|QJ|BOL|IOG|C\/|S\/|MG|M\/G|DET|SAB|CHAMP|DIG|INT|INTEG|NAT|EMB|CONG|FRESC|RECARGA|2EM1|UHT|FUM|CZ|DOP)\b/i;
const score = (d) => (d.match(new RegExp(ABREV, 'gi'))?.length || 0) + (/\d/.test(d) ? 1 : 0);
cand.forEach((c) => (c.s = score(c.d)));
cand.sort((a, b) => b.s - a.s || b.n - a.n);
// pega 20, no máx 5 por cadeia (diversidade)
const porCadeia = {};
const escolhidas = [];
for (const c of cand) {
  porCadeia[c.cadeia] = (porCadeia[c.cadeia] || 0) + 1;
  if (porCadeia[c.cadeia] > 5) continue;
  escolhidas.push(c);
  if (escolhidas.length >= 20) break;
}
console.log('descrições escolhidas:', escolhidas.length, '| modelos:', MODELS.length, '\n');

const art = [];
for (const e of escolhidas) {
  const linha = { d: e.d, cadeia: e.cadeia, modelos: {} };
  for (const [model, tag] of MODELS) {
    try {
      const c = await canonicalizar(e.d, { model, cadeia: e.cadeia });
      linha.modelos[tag] = c;
    } catch (err) {
      linha.modelos[tag] = { erro: String(err.message || err).slice(0, 80) };
    }
    process.stdout.write('.');
  }
  art.push(linha);
  process.stdout.write(' ' + e.d.slice(0, 30) + '\n');
}
await db.end();

// Convergência: agrupa os nomes dos modelos por similaridade; cluster maior = consenso
const norm = (x) => normalizarNome(String(x || ''));
function maiorCluster(nomes) {
  const cls = [];
  for (const n of nomes) {
    let best = null, bs = 0;
    for (const cl of cls) { const s = norm(n) === norm(cl.rep) ? 1 : similaridade(n, cl.rep); if (s > bs) { bs = s; best = cl; } }
    if (best && bs >= 0.7) best.n++; else cls.push({ rep: n, n: 1 });
  }
  return Math.max(...cls.map((c) => c.n));
}

// Métricas por modelo
console.log('\n================ POR MODELO ================');
console.log('modelo'.padEnd(9), 'conf.méd', 'no-consenso', 'unid divergente', 'erros');
const stat = {};
for (const [, tag] of MODELS) stat[tag] = { conf: [], cons: 0, err: 0 };
let unidDiv = 0;
for (const l of art) {
  const nomes = MODELS.map(([, t]) => l.modelos[t]).filter((c) => c && !c.erro).map((c) => c.nome_canonico);
  const maxc = maiorCluster(nomes);
  const unids = new Set(MODELS.map(([, t]) => l.modelos[t]).filter((c) => c && !c.erro).map((c) => c.unidade_base));
  if (unids.size > 1) unidDiv++;
  for (const [, t] of MODELS) {
    const c = l.modelos[t];
    if (!c || c.erro) { stat[t].err++; continue; }
    stat[t].conf.push(c.confianca);
    // "em consenso" = o seu nome cai no maior cluster
    const outros = nomes;
    const dentro = outros.filter((n) => norm(n) === norm(c.nome_canonico) || similaridade(n, c.nome_canonico) >= 0.7).length;
    if (dentro >= maxc) stat[t].cons++;
  }
}
for (const [, t] of MODELS) {
  const s = stat[t];
  const conf = s.conf.length ? (s.conf.reduce((a, b) => a + b, 0) / s.conf.length).toFixed(2) : '?';
  console.log(t.padEnd(9), String(conf).padEnd(8), (s.cons + '/' + art.length).padEnd(11), '', '', String(s.err));
}
console.log('\ndescrições com unidade DIVERGENTE entre modelos:', unidDiv, '/', art.length);

// Lado-a-lado: as MAIS divergentes primeiro (onde "reconhecer" diverge)
const div = art.map((l) => {
  const nomes = MODELS.map(([, t]) => l.modelos[t]).filter((c) => c && !c.erro).map((c) => c.nome_canonico);
  return { l, d: nomes.length ? 1 - maiorCluster(nomes) / nomes.length : 0 };
}).sort((a, b) => b.d - a.d);
console.log('\n================ LADO-A-LADO (mais divergentes no topo) ================');
for (const { l } of div) {
  console.log('\n▸ "' + l.d + '"  [' + l.cadeia + ']');
  for (const [, t] of MODELS) {
    const c = l.modelos[t];
    if (!c || c.erro) { console.log('   ' + t.padEnd(8), '⚠ ' + (c?.erro || 'erro')); continue; }
    console.log('   ' + t.padEnd(8), (c.nome_canonico || '?').padEnd(34), '| ' + (c.marca || '—').padEnd(12), '| ' + c.unidade_base + ' (' + c.confianca + ')');
  }
}
await writeFile('scripts/_canonical_resultados.json', JSON.stringify(art, null, 2));
console.log('\nartefactos → backend/scripts/_canonical_resultados.json');

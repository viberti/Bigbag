// Aprende os ENVELOPES NUTRICIONAIS por família a partir do corpus LIMPO (base_local,
// pós-limpeza A+B) e MEDE quantos produtos são "plausível-mas-errado" (outliers de família).
// Camada C da qualidade de dados (2026-06-30). Gera data/envelopes_nutricao.json (versionado).
//
//   sudo -u dev node --env-file=.env scripts/envelopes_nutricao.mjs          # construir + medir
//   sudo -u dev node --env-file=.env scripts/envelopes_nutricao.mjs --medir  # só medir (lê o JSON)
//
// REGRA: outlier de família = SUSPEITO (sinal p/ confiança/revisão), NÃO se apaga.
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, parseJsonCol } from '../src/db.js';
import { familiaPorNome } from '../src/normaliza/familia.js';
import { construirEnvelopes, nutricaoSuspeita } from '../src/normaliza/envelopeNutricao.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(DIR, '..', 'data', 'envelopes_nutricao.json');

async function carregarAmostras(pool) {
  const [rows] = await pool.query('SELECT nome, nutricao FROM base_local WHERE nutricao IS NOT NULL');
  const amostras = [];
  for (const r of rows) {
    const n = parseJsonCol(r.nutricao);
    const familia = familiaPorNome ? familiaPorNome(r.nome || '') : null;
    if (n && familia) amostras.push({ familia, n, nome: r.nome });
  }
  return amostras;
}

const pool = getPool();
const soMedir = process.argv.includes('--medir');
try {
  const amostras = await carregarAmostras(pool);
  let envelopes;
  if (soMedir) {
    envelopes = JSON.parse(await readFile(JSON_PATH, 'utf8'));
    console.log(`[envelopes] lidos ${Object.keys(envelopes).length} envelopes de ${JSON_PATH}`);
  } else {
    envelopes = construirEnvelopes(amostras);
    await writeFile(JSON_PATH, JSON.stringify(envelopes, null, 0));
    console.log(`[envelopes] construídos ${Object.keys(envelopes).length} envelopes de família (${amostras.length} amostras) → ${JSON_PATH}`);
  }
  // medição: quantos produtos têm ≥1 nutriente outlier da sua família
  let suspeitos = 0;
  const porNut = {}; const exemplos = [];
  for (const a of amostras) {
    const s = nutricaoSuspeita(a.n, a.familia, envelopes);
    if (s.length) {
      suspeitos++;
      for (const x of s) porNut[x.nutriente] = (porNut[x.nutriente] || 0) + 1;
      if (exemplos.length < 12) exemplos.push(`${(a.nome || '').slice(0, 30)} [${a.familia}] ${s.map((x) => `${x.nutriente}=${x.valor} (p50 ${x.p50}, ${x.lado})`).join(', ')}`);
    }
  }
  const pct = amostras.length ? (100 * suspeitos / amostras.length).toFixed(1) : 0;
  console.log(`[envelopes] SUSPEITOS (plausível-mas-errado): ${suspeitos} / ${amostras.length} (${pct}%)`);
  console.log('[envelopes] por nutriente:', JSON.stringify(porNut));
  console.log('[envelopes] exemplos:'); exemplos.forEach((e) => console.log('  ' + e));
  await pool.end();
  process.exit(0);
} catch (e) { console.error(e.message); await pool.end().catch(() => {}); process.exit(1); }

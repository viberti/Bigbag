// VALIDADOR canónico (design (1), P1.5 — a peça de maior ROI). Para cada commodity da base_local,
// calcula a nutrição CANÓNICA (variante certa) e sinaliza quem DIVERGE dela acima de um limiar
// (energia >25 % ou saturada >2×). É um tripwire de qualidade: apanha o que A/C2/C3 não apanham —
// incl. typos em dados "confirmados". NÃO altera dados — só mede/sinaliza. (Ainda sem override P2.)
//
//   sudo -u dev node --env-file=.env scripts/validar_canonico.mjs
import { getPool, parseJsonCol } from '../src/db.js';
import { familiaPorNome } from '../src/normaliza/familia.js';
import { nutricaoCanonica, familiasCanonicas } from '../src/normaliza/nutricaoCanonica.js';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
function divergencias(prod, canon) {
  const m = [];
  const e = num(prod.energia_kcal), ce = num(canon.energia_kcal);
  if (e != null && ce > 0 && Math.abs(e - ce) / ce > 0.25) m.push(`energia ${e}≠${ce}`);
  const s = num(prod.gordura_saturada), cs = num(canon.gordura_saturada);
  if (s != null && cs != null && s > cs * 2 + 1) m.push(`saturada ${s}≫${cs}`);
  const a = num(prod.acucares), ca = num(canon.acucares);
  if (a != null && ca != null && Math.abs(a - ca) > 15) m.push(`açúcar ${a}≠${ca}`);
  return m;
}

const pool = getPool();
try {
  const fams = new Set(familiasCanonicas());
  const [rows] = await pool.query('SELECT nome, nutricao FROM base_local WHERE nutricao IS NOT NULL');
  let comCanon = 0, diverg = 0; const porFam = {}; const ex = [];
  for (const r of rows) {
    const familia = familiaPorNome(r.nome || '');
    if (!fams.has(familia)) continue;
    const c = nutricaoCanonica(familia, r.nome);
    if (!c) continue; // tem qualificador/forma → não se força nem valida contra o simples
    comCanon++;
    const n = parseJsonCol(r.nutricao);
    const m = divergencias(n, c.nut);
    if (m.length) {
      diverg++; porFam[familia] = (porFam[familia] || 0) + 1;
      if (ex.length < 14) ex.push(`[${familia}] ${String(r.nome).slice(0, 34).padEnd(34)} ${m.join(', ')}`);
    }
  }
  console.log(`[canon] commodities com canónico aplicável: ${comCanon}`);
  console.log(`[canon] DIVERGEM do canónico (suspeitos de dados): ${diverg} (${comCanon ? (100 * diverg / comCanon).toFixed(1) : 0}%)`);
  console.log('[canon] por família:', JSON.stringify(porFam));
  console.log('[canon] exemplos:'); ex.forEach((e) => console.log('  ' + e));
  await pool.end(); process.exit(0);
} catch (e) { console.error(e.message); await pool.end().catch(() => {}); process.exit(1); }

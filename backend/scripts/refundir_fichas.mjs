// BACKFILL do resolvedor único (2026-06-13): re-funde TODAS as fichas por EAN
// com a tabela de prioridades de normaliza/fichaEan.js. Decisão do dono: APLICA
// e REGISTA o diff (JSONL) para revisão posterior — correções via aba Fichas.
//   node scripts/refundir_fichas.mjs            (aplica + regista)
//   DIFF=/tmp/x.jsonl node scripts/refundir_fichas.mjs
import { writeFileSync, appendFileSync } from 'node:fs';
import { getPool } from '../src/db.js';
import { fundirFichaEan } from '../src/normaliza/fichaEan.js';

const OUT = process.env.DIFF || `/home/dev/bigbag/backend/fusao_diff_${new Date().toISOString().slice(0, 10)}.jsonl`;
const pool = getPool();
const lim = (s, n) => (s == null ? null : String(s).slice(0, n));
const [fichas] = await pool.query("SELECT * FROM produto_ean WHERE ean IS NOT NULL AND ean <> '' ORDER BY id");
console.log(`fichas com EAN: ${fichas.length} · diff → ${OUT}`);
writeFileSync(OUT, '');

let mudadas = 0, intactas = 0, camposMudados = {};
for (const atual of fichas) {
  try {
    const r = await fundirFichaEan(pool, atual.ean, { atual });
    if (!r.ficha.nome && !atual.nome) { intactas++; continue; } // pendentes continuam pendentes
    const f = r.ficha;
    const parse = (v) => { try { return v == null ? null : typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
    const diffs = [];
    const cmp = (campo, novo, velho) => {
      const a = novo == null ? null : String(novo), b = velho == null ? null : String(velho);
      if (a !== b) { diffs.push({ campo, de: lim(b, 120), para: lim(a, 120), fonte: r.fusao.proveniencia[campo] || null }); camposMudados[campo] = (camposMudados[campo] || 0) + 1; }
    };
    cmp('nome', f.nome, atual.nome); cmp('marca', f.marca, atual.marca);
    cmp('quantidade', f.quantidade, atual.quantidade); cmp('categoria', f.categoria, atual.categoria);
    cmp('ingredientes', f.ingredientes, atual.ingredientes); cmp('alergenios', f.alergenios, atual.alergenios);
    cmp('nutricao', f.nutricao ? JSON.stringify(f.nutricao) : null, atual.nutricao ? JSON.stringify(parse(atual.nutricao)) : null);
    if (!diffs.length) { intactas++; continue; }
    appendFileSync(OUT, JSON.stringify({ ean: atual.ean, nome: f.nome, diffs }) + '\n');
    await pool.query(
      `UPDATE produto_ean SET nome=?, marca=?, quantidade=?, categoria=?, ingredientes=?, alergenios=?,
              nutricao=?, nutricao_confirmada=?, fusao=? WHERE id=?`,
      [lim(f.nome, 200), lim(f.marca, 120), lim(f.quantidade, 60), lim(f.categoria, 255),
        f.ingredientes, f.alergenios, f.nutricao ? JSON.stringify(f.nutricao) : null,
        f.nutricao_confirmada, JSON.stringify(r.fusao), atual.id]);
    mudadas++;
  } catch (e) { console.error('  erro', atual.ean, e.message); }
}
console.log(`\nmudadas: ${mudadas} · intactas: ${intactas}`);
console.log('campos mudados:', JSON.stringify(camposMudados));
console.log(`diff completo em ${OUT} — rever quando quiseres; corrigir na aba Fichas (vira 'manual').`);
process.exit(0);

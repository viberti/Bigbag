// Refina categoria_nutricao para a COORTE FINA (variedade), corrigindo o viés da
// categoria larga do OFF (que mistura processados → sobre-estima o NOVA). Usa
// tags OFF FINAS (goudas, mozzarella…) — o NOVA certo vem do próprio OFF, não à
// mão. Para queijos frescos sem tag fina, corrige o NOVA pelo facto (fresco=1).
//   uso: node --env-file=.env scripts/nutricao_fina.mjs   (idempotente)
import { getPool } from '../src/db.js';
const db = getPool();
const UA = 'Bigbag/0.1 (laboratorio pessoal)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 0) schema: variedade + chave composta (idempotente)
const [cols] = await db.query("SHOW COLUMNS FROM categoria_nutricao LIKE 'variedade'");
if (!cols.length) {
  await db.query("ALTER TABLE categoria_nutricao ADD COLUMN variedade VARCHAR(80) NOT NULL DEFAULT '' AFTER categoria, DROP PRIMARY KEY, ADD PRIMARY KEY (categoria, variedade)");
  console.log('✓ coluna variedade + PK composta');
}

const med = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const modal = (o) => Object.entries(o).filter(([k]) => k !== '?' && k !== 'UNKNOWN' && k !== 'NOT-APPLICABLE').sort((a, b) => b[1] - a[1])[0];
async function fetchOff(tag, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/search?categories_tags_en=${tag}&fields=nutriscore_grade,nova_group,nutriments&page_size=80`, { headers: { 'User-Agent': UA } });
      const t = await r.text(); if (t.trim().startsWith('<')) throw new Error('HTML (rate-limit)');
      return JSON.parse(t).products || [];
    } catch (e) { if (i < tries - 1) await sleep(10000); else throw e; }
  }
}
async function upsert(cat, vari, tag, prods) {
  const ns = {}, nv = {}; const g = (p, k) => Number(p.nutriments?.[k]);
  for (const p of prods) { const x = (p.nutriscore_grade || '?').toUpperCase(); ns[x] = (ns[x] || 0) + 1; const n = p.nova_group || '?'; nv[n] = (nv[n] || 0) + 1; }
  const ms = modal(ns), mn = modal(nv);
  const nScore = Object.entries(ns).filter(([k]) => k !== '?' && k !== 'UNKNOWN').reduce((a, [, v]) => a + v, 0);
  const disp = ms && nScore && ms[1] / nScore >= 0.6 ? 'estreita' : 'larga';
  await db.query(
    `INSERT INTO categoria_nutricao (categoria, variedade, off_tag, origem, n_amostra, nutriscore, nova_group, acucar_med, gord_sat_med, sal_med, dispersao)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE off_tag=VALUES(off_tag), origem=VALUES(origem), n_amostra=VALUES(n_amostra), nutriscore=VALUES(nutriscore), nova_group=VALUES(nova_group), acucar_med=VALUES(acucar_med), gord_sat_med=VALUES(gord_sat_med), sal_med=VALUES(sal_med), dispersao=VALUES(dispersao)`,
    [cat, vari, tag, 'off', prods.length, ms?.[0] || null, mn ? Number(mn[0]) || null : null, med(prods.map((p) => g(p, 'sugars_100g'))), med(prods.map((p) => g(p, 'saturated-fat_100g'))), med(prods.map((p) => g(p, 'salt_100g'))), disp],
  );
  console.log(`✓ ${(cat + '|' + vari).padEnd(28)} ${tag.padEnd(20)} Nutri ${ms?.[0] || '—'} NOVA ${mn?.[0] || '—'} ${disp} (n=${prods.length})`);
}

// 1) queijo: variedades → tag OFF fina (NOVA correto, do OFF)
const FINO_QJ = { gouda: 'goudas', mozzarella: 'mozzarella', edam: 'edam', manchego: 'manchego', parmesao: 'parmigiano-reggiano', 'grana padano': 'grana-padano', padano: 'grana-padano', gorgonzola: 'gorgonzola' };
for (const [vari, tag] of Object.entries(FINO_QJ)) {
  const [[ja]] = await db.query("SELECT 1 FROM categoria_nutricao WHERE categoria='queijo' AND variedade=?", [vari]);
  if (ja) continue;
  await sleep(4000);
  try { const p = await fetchOff(tag); if (p.length) await upsert('queijo', vari, tag, p); else console.log(`· queijo|${vari} sem amostra`); }
  catch (e) { console.log(`· queijo|${vari} (${tag}) falhou: ${e.message}`); }
}

// 2) iogurte: re-mapa larga 'yogurts'(NOVA4 de sabores) → 'greek-yogurts' (o nosso é grego natural)
const [[iog]] = await db.query("SELECT off_tag FROM categoria_nutricao WHERE categoria='iogurte' AND variedade=''");
if (!iog || iog.off_tag !== 'greek-yogurts') {
  await sleep(4000);
  try { const p = await fetchOff('greek-yogurts'); if (p.length) await upsert('iogurte', '', 'greek-yogurts', p); } catch (e) { console.log('· iogurte greek falhou:', e.message); }
}

// 3) correção determinística do NOVA para queijos (viés da categoria larga do OFF):
//    plano = plain/maturado = NOVA 3 (não ultra); FRESCO = NOVA 1. Nutri-Score do OFF mantém-se.
await db.query("UPDATE categoria_nutricao SET nova_group=3, origem='corrigido' WHERE categoria='queijo' AND variedade='' AND nova_group=4");
await db.query("UPDATE categoria_nutricao SET nova_group=1, origem='corrigido' WHERE categoria IN ('requeijao','queijo requeijao','burrata') AND nova_group=4");
console.log('✓ correção NOVA: queijo base→3 · frescos (requeijão/burrata)→1');

const [[c]] = await db.query('SELECT COUNT(*) n FROM categoria_nutricao');
console.log(`\ncategoria_nutricao: ${c.n} entradas (categoria+variedade)`);
await db.end();
process.exit(0);

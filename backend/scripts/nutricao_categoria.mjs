// Povoa categoria_nutricao (busca-uma-vez ao OFF, devagar, idempotente).
// Whole foods / carne fresca → determinístico (NOVA 1). Lácteos/processados →
// OFF (mediana + Nutri-Score/NOVA modais + dispersão). Re-corrível: só busca o
// que ainda não está em cache (assim retoma se o OFF nos limitar a meio).
//   uso: node --env-file=.env scripts/nutricao_categoria.mjs
import { getPool } from '../src/db.js';
const db = getPool();
const UA = 'Bigbag/0.1 (laboratorio pessoal)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// categoria (do Mestre) → como obter a nutrição
const MAPA = {
  queijo: { t: 'off', tag: 'cheeses' }, burrata: { t: 'off', tag: 'cheeses' }, requeijao: { t: 'off', tag: 'cheeses' }, 'queijo requeijao': { t: 'off', tag: 'cheeses' },
  iogurte: { t: 'off', tag: 'yogurts' }, leite: { t: 'off', tag: 'milks' }, 'natas de culinaria': { t: 'off', tag: 'creams' }, manteiga: { t: 'off', tag: 'butters' },
  'chocolate negro': { t: 'off', tag: 'dark-chocolates' }, 'chocolate de leite': { t: 'off', tag: 'milk-chocolates' }, 'leite com chocolate': { t: 'off', tag: 'chocolate-milks' },
  pao: { t: 'off', tag: 'breads' }, 'pao de forma': { t: 'off', tag: 'sandwich-breads' }, arroz: { t: 'off', tag: 'rices' }, fiambre: { t: 'off', tag: 'hams' },
  cafe: { t: 'off', tag: 'coffees' }, 'capsulas de cafe': { t: 'off', tag: 'coffees' }, 'cafe descafeinado': { t: 'off', tag: 'coffees' },
  'cereais de pequeno almoco': { t: 'off', tag: 'breakfast-cereals' }, cerveja: { t: 'off', tag: 'beers' }, mel: { t: 'off', tag: 'honeys' }, sumo: { t: 'off', tag: 'fruit-juices' }, bolachas: { t: 'off', tag: 'biscuits' },
  frango: { t: 'meat' }, 'carne de bovino': { t: 'meat' }, 'bife de novilho': { t: 'meat' },
  ovos: { t: 'whole', nutri: 'B', nova: 1 },
  banana: { t: 'whole' }, salada: { t: 'whole' }, batata: { t: 'whole' }, rucula: { t: 'whole' }, pera: { t: 'whole' }, alperce: { t: 'whole' },
  pessego: { t: 'whole' }, mirtilo: { t: 'whole' }, tomate: { t: 'whole' }, cenoura: { t: 'whole' }, figo: { t: 'whole' }, maca: { t: 'whole' }, toranja: { t: 'whole' }, cebola: { t: 'whole' }, 'feijao preto': { t: 'whole' },
  detergente: { t: 'skip' },
};

const med = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const modal = (o) => Object.entries(o).filter(([k]) => k !== '?' && k !== 'UNKNOWN' && k !== 'NOT-APPLICABLE').sort((a, b) => b[1] - a[1])[0];

async function fetchOff(tag, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const u = `https://world.openfoodfacts.org/api/v2/search?categories_tags_en=${tag}&fields=nutriscore_grade,nova_group,nutriments&page_size=80`;
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      const txt = await r.text();
      if (txt.trim().startsWith('<')) throw new Error('HTML (rate-limit)');
      return JSON.parse(txt).products || [];
    } catch (e) { if (i < tries - 1) await sleep(10000); else throw e; }
  }
}

const cats = Object.keys(MAPA);
for (const cat of cats) {
  const [[ja]] = await db.query('SELECT 1 FROM categoria_nutricao WHERE categoria = ?', [cat]);
  if (ja) { continue; }
  const m = MAPA[cat];
  if (m.t === 'skip') continue;
  let row;
  if (m.t === 'whole') row = { origem: 'whole', off_tag: null, n: null, nutri: m.nutri || 'A', nova: m.nova || 1, su: null, sf: null, sl: null, disp: 'estreita' };
  else if (m.t === 'meat') row = { origem: 'meat', off_tag: null, n: null, nutri: null, nova: 1, su: null, sf: null, sl: null, disp: 'estreita' };
  else {
    await sleep(4000);
    let prods;
    try { prods = await fetchOff(m.tag); } catch (e) { console.log(`· ${cat} (${m.tag}) FALHOU: ${e.message} — fica p/ re-run`); continue; }
    if (!prods.length) { console.log(`· ${cat} (${m.tag}) sem amostra`); continue; }
    const g = (p, k) => Number(p.nutriments?.[k]);
    const ns = {}, nv = {};
    for (const p of prods) { const x = (p.nutriscore_grade || '?').toUpperCase(); ns[x] = (ns[x] || 0) + 1; const n = p.nova_group || '?'; nv[n] = (nv[n] || 0) + 1; }
    const ms = modal(ns), mn = modal(nv);
    const nComScore = Object.entries(ns).filter(([k]) => k !== '?' && k !== 'UNKNOWN').reduce((a, [, v]) => a + v, 0);
    const disp = ms && nComScore && ms[1] / nComScore >= 0.6 ? 'estreita' : 'larga'; // concentração do modal
    row = { origem: 'off', off_tag: m.tag, n: prods.length, nutri: ms?.[0] || null, nova: mn ? Number(mn[0]) || null : null,
      su: med(prods.map((p) => g(p, 'sugars_100g'))), sf: med(prods.map((p) => g(p, 'saturated-fat_100g'))), sl: med(prods.map((p) => g(p, 'salt_100g'))), disp };
  }
  await db.query(
    `INSERT INTO categoria_nutricao (categoria, off_tag, origem, n_amostra, nutriscore, nova_group, acucar_med, gord_sat_med, sal_med, dispersao)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [cat, row.off_tag, row.origem, row.n, row.nutri, row.nova, row.su, row.sf, row.sl, row.disp],
  );
  console.log(`✓ ${cat.padEnd(28)} ${row.origem.padEnd(6)} Nutri ${row.nutri || '—'}  NOVA ${row.nova || '—'}  ${row.disp}${row.n ? ` (n=${row.n})` : ''}`);
}
const [[c]] = await db.query('SELECT COUNT(*) n FROM categoria_nutricao');
console.log(`\ncategoria_nutricao: ${c.n} categorias em cache`);
await db.end();
process.exit(0);

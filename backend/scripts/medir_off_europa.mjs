// MEDIÇÃO (não importa): faz streaming do dump COMPLETO do OFF e conta o que
// ganharíamos alargando o filtro de Portugal → Europa. Cruza com os EANs que já
// temos (off_produto + catalogo_produto + item/talões).
//   sudo -u dev node --env-file=.env scripts/medir_off_europa.mjs [--teste=500000]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { getPool } from '../src/db.js';
import { eanValido } from '../src/ingest/produto.js';

const DUMP = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';
const TESTE = Number((process.argv.find((a) => a.startsWith('--teste=')) || '').split('=')[1]) || 0;
const EU = new Set(['portugal', 'spain', 'france', 'germany', 'italy', 'netherlands', 'belgium', 'luxembourg',
  'austria', 'ireland', 'poland', 'czech-republic', 'slovakia', 'slovenia', 'croatia', 'hungary', 'romania',
  'bulgaria', 'greece', 'denmark', 'sweden', 'finland', 'estonia', 'latvia', 'lithuania', 'cyprus', 'malta',
  'united-kingdom', 'switzerland', 'norway']);

const pool = getPool();
const carregarEans = async (tab) => {
  const [rows] = await pool.query(`SELECT DISTINCT ean e FROM ${tab} WHERE ean IS NOT NULL AND ean <> ''`);
  return new Set(rows.map((r) => String(r.e)));
};
const off0 = await carregarEans('off_produto');
const cat = await carregarEans('catalogo_produto');
const talao = await carregarEans('item');
const jaTemos = new Set([...off0, ...cat]);
console.error(`temos: off ${off0.size} · catalogo ${cat.size} · talões ${talao.size}`);

const curl = spawn('curl', ['-sL', '--retry', '3', DUMP]);
curl.on('error', (e) => { console.error('curl erro', e.message); process.exit(1); });
const rl = createInterface({ input: curl.stdout.pipe(createGunzip()), crlfDelay: Infinity });

let total = 0, comEan = 0, eu = 0, euMarca = 0, euNutri = 0, euNovo = 0, euJaCat = 0, matchTalao = 0;
const t0 = Date.now();
for await (const line of rl) {
  total++;
  if (TESTE && total > TESTE) break;
  let d; try { d = JSON.parse(line); } catch { continue; }
  const code = String(d.code || '').replace(/\D/g, '');
  if (!eanValido(code)) continue;
  comEan++;
  if (talao.has(code)) matchTalao++;
  const paises = (d.countries_tags || []).map((x) => String(x).replace(/^en:/, ''));
  if (!paises.some((p) => EU.has(p))) continue;
  eu++;
  if (d.brands && String(d.brands).trim()) euMarca++;
  if (d.nutriments && Object.keys(d.nutriments).length) euNutri++;
  if (!jaTemos.has(code)) euNovo++;
  if (cat.has(code)) euJaCat++;
  if (total % 200000 === 0) process.stderr.write(`\r  ${total} lidos · ${(total / ((Date.now() - t0) / 1000) / 1000).toFixed(0)}k/s · EU ${eu} · novos ${euNovo}   `);
}
console.log('\n══════ RESULTADO ══════');
console.log(`linhas lidas:            ${total}`);
console.log(`com EAN válido:          ${comEan}`);
console.log(`EUROPEUS (≥1 país EU):   ${eu}`);
console.log(`  ...com marca:          ${euMarca}`);
console.log(`  ...com nutrição:       ${euNutri}`);
console.log(`  ...NOVOS (não temos):  ${euNovo}   ← ganho líquido de EANs`);
console.log(`  ...já no catálogo PT:  ${euJaCat}   ← enriquecimento direto`);
console.log(`OFF que casa um EAN de TALÃO nosso: ${matchTalao}`);
await pool.end();
process.exit(0);

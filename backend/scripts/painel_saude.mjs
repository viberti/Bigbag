// Painel de saúde do cesto: cruza as compras reais com a cache categoria_nutricao,
// preferindo a COORTE FINA (categoria+variedade) e caindo para a categoria larga.
//   uso: node --env-file=.env scripts/painel_saude.mjs
import { getPool } from '../src/db.js';
const db = getPool();

// cache em memória: 'categoria|variedade' → linha
const [cn] = await db.query('SELECT categoria, variedade, nutriscore, nova_group, dispersao FROM categoria_nutricao');
const cache = new Map(cn.map((r) => [`${r.categoria}|${r.variedade || ''}`, r]));
const look = (cat, vari) => cache.get(`${cat}|${vari}`) || cache.get(`${cat}|`) || null;

// compras agrupadas por (categoria, variedade extraída da chave do Mestre)
const [its] = await db.query(`
  SELECT m.categoria cat,
         SUBSTRING_INDEX(SUBSTRING_INDEX(m.chave,'|',5),'|',-1) AS vari,
         COUNT(i.id) n
    FROM produto_mestre m
    JOIN sku_normalizado s ON s.mestre_id = m.id
    JOIN item i ON i.sku_id = s.id AND i.is_non_product = 0
   GROUP BY m.categoria, vari`);
const total = its.reduce((a, x) => a + x.n, 0);

let comNut = 0, semNut = 0;
const nova = {}, nutri = {}, ultra = {}, largas = {};
for (const x of its) {
  const r = look(x.cat, x.vari || '');
  if (!r || (r.nova_group == null && r.nutriscore == null)) { semNut += x.n; continue; }
  comNut += x.n;
  if (r.nova_group != null) nova[r.nova_group] = (nova[r.nova_group] || 0) + x.n;
  if (r.nutriscore) nutri[r.nutriscore] = (nutri[r.nutriscore] || 0) + x.n;
  const rot = x.vari ? `${x.cat} ${x.vari}` : x.cat;
  if (String(r.nova_group) === '4') ultra[rot] = (ultra[rot] || 0) + x.n;
  if (r.dispersao === 'larga') largas[rot] = (largas[rot] || 0) + x.n;
}
const bar = (v, t) => '█'.repeat(Math.round(38 * v / (t || 1)));
const lst = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' · ') || 'nenhum';
const NOVA_LBL = { 1: 'não processado', 2: 'ingrediente culinário', 3: 'processado', 4: 'ULTRAprocessado' };

console.log(`\n══════════ PAINEL DE SAÚDE DO CESTO ══════════`);
console.log(`Compras: ${total} · com nutrição: ${comNut} (${(100 * comNut / total).toFixed(0)}%) · sem: ${semNut}\n`);
console.log('GRAU DE PROCESSAMENTO (NOVA · % das compras com nutrição):');
const tN = Object.values(nova).reduce((a, b) => a + b, 0) || 1;
for (const k of ['1', '2', '3', '4']) if (nova[k]) console.log(`  NOVA ${k} ${(NOVA_LBL[k] || '').padEnd(20)} ${bar(nova[k], tN)} ${(100 * nova[k] / tN).toFixed(0)}% (${nova[k]})`);
console.log('\nNUTRI-SCORE (% das compras com score):');
const tS = Object.values(nutri).reduce((a, b) => a + b, 0) || 1;
for (const k of ['A', 'B', 'C', 'D', 'E']) if (nutri[k]) console.log(`  ${k} ${bar(nutri[k], tS)} ${(100 * nutri[k] / tS).toFixed(0)}% (${nutri[k]})`);
console.log('\nULTRAPROCESSADOS (NOVA 4):\n  ' + lst(ultra));
console.log('\nBAIXA CONFIANÇA (dispersão larga → um scan dá precisão):\n  ' + lst(largas));
await db.end();
process.exit(0);

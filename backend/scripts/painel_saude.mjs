// Painel de saúde do cesto: cruza as compras reais com a cache categoria_nutricao
// (nutrição pendurada na classe) e mostra o retrato — NOVA (processamento),
// Nutri-Score, ultraprocessados, e onde a confiança é baixa (scan compensa).
//   uso: node --env-file=.env scripts/painel_saude.mjs
import { getPool } from '../src/db.js';
const db = getPool();

const [its] = await db.query(`
  SELECT m.categoria cat, COUNT(i.id) n,
         cn.nutriscore, cn.nova_group, cn.dispersao, cn.origem
    FROM produto_mestre m
    JOIN sku_normalizado s ON s.mestre_id = m.id
    JOIN item i ON i.sku_id = s.id AND i.is_non_product = 0
    LEFT JOIN categoria_nutricao cn ON cn.categoria = m.categoria
   GROUP BY m.categoria`);
const total = its.reduce((a, x) => a + x.n, 0);
let comNut = 0, semNut = 0;
const nova = {}, nutri = {}, ultra = [], largas = [];
for (const x of its) {
  if (x.nova_group == null && x.nutriscore == null) { semNut += x.n; continue; }
  comNut += x.n;
  if (x.nova_group != null) nova[x.nova_group] = (nova[x.nova_group] || 0) + x.n;
  if (x.nutriscore) nutri[x.nutriscore] = (nutri[x.nutriscore] || 0) + x.n;
  if (String(x.nova_group) === '4') ultra.push(`${x.cat}(${x.n})`);
  if (x.dispersao === 'larga') largas.push(`${x.cat}(${x.n})`);
}
const bar = (v, t) => '█'.repeat(Math.round(38 * v / (t || 1)));
console.log(`\n══════════ PAINEL DE SAÚDE DO CESTO ══════════`);
console.log(`Compras: ${total} · com nutrição: ${comNut} (${(100 * comNut / total).toFixed(0)}%) · sem: ${semNut}\n`);
console.log('GRAU DE PROCESSAMENTO (NOVA · % das compras com nutrição):');
const tN = Object.values(nova).reduce((a, b) => a + b, 0) || 1;
const NOVA_LBL = { 1: 'não processado', 2: 'ingrediente culinário', 3: 'processado', 4: 'ULTRAprocessado' };
for (const k of ['1', '2', '3', '4']) if (nova[k]) console.log(`  NOVA ${k} ${(NOVA_LBL[k] || '').padEnd(20)} ${bar(nova[k], tN)} ${(100 * nova[k] / tN).toFixed(0)}% (${nova[k]})`);
console.log('\nNUTRI-SCORE (% das compras com score):');
const tS = Object.values(nutri).reduce((a, b) => a + b, 0) || 1;
for (const k of ['A', 'B', 'C', 'D', 'E']) if (nutri[k]) console.log(`  ${k} ${bar(nutri[k], tS)} ${(100 * nutri[k] / tS).toFixed(0)}% (${nutri[k]})`);
console.log('\nULTRAPROCESSADOS (NOVA 4) no cesto:\n  ' + (ultra.sort().join(' · ') || 'nenhum'));
console.log('\nBAIXA CONFIANÇA (dispersão larga → um scan dá precisão):\n  ' + (largas.sort().join(' · ') || 'nenhuma'));
await db.end();
process.exit(0);

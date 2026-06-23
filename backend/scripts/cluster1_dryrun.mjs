// CLUSTER 1 — DRY-RUN (SOMENTE SELECT, não escreve nada). Classifica fontes por vertical e
// conta os valores-não-preço (sentinela/centavo) que vazaram, por tabela e por escopo.
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
const pool = getPool();
const FARM = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8')).map((f) => f.fonte);
const MERC = JSON.parse(readFileSync(new URL('./fontes_vtex.json', import.meta.url), 'utf8')).map((f) => f.fonte);
const inFarm = '(' + FARM.map(() => '?').join(',') + ')';
const hr = (s) => console.log('\n' + '═'.repeat(74) + '\n' + s);
async function tab(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  if (!rows.length) return console.log('  (sem linhas)');
  const cols = Object.keys(rows[0]); const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  console.log('  ' + cols.map((c, i) => c.padEnd(w[i])).join(' | '));
  for (const r of rows) console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join(' | '));
}

hr('PART 1b — CLASSIFICAÇÃO de fontes BRL por vertical (manifesto onde está)');
const [fontes] = await pool.query("SELECT fonte, COUNT(*) linhas FROM catalogo_produto WHERE moeda='BRL' AND preco>0 GROUP BY fonte ORDER BY fonte");
const cls = (f) => FARM.includes(f) ? 'FARMACIA' : MERC.includes(f) ? 'MERCEARIA' : '??? (não está em nenhum manifesto)';
const farm = [], merc = [], outros = [];
for (const r of fontes) { const c = cls(r.fonte); (c === 'FARMACIA' ? farm : c === 'MERCEARIA' ? merc : outros).push(`${r.fonte}(${r.linhas})`); }
console.log('\nFARMACIA (' + farm.length + '): ' + farm.join(', '));
console.log('\nMERCEARIA (' + merc.length + '): ' + merc.join(', '));
console.log('\nNÃO CLASSIFICADO (' + outros.length + ', precisa decisão tua): ' + (outros.join(', ') || '(nenhum)'));

hr('PART 2.2a — DISTRIBUIÇÃO de preços ALTOS (confirmar que sentinela é isolado, não há legítimo perto)');
await tab(`SELECT
  SUM(preco=99999)                          AS exato_99999,
  SUM(preco=999999)                         AS exato_999999,
  SUM(preco=9999999)                        AS exato_9999999,
  SUM(preco BETWEEN 50000 AND 99998)        AS faixa_50k_a_99998_LEGIT,
  SUM(preco BETWEEN 100000 AND 999998)      AS faixa_100k_a_999998,
  MAX(CASE WHEN preco NOT IN(99999,999999,9999999) THEN preco END) AS maior_preco_nao_sentinela
 FROM catalogo_produto WHERE moeda='BRL' AND preco>0`);

hr('PART 2.2b — DISTRIBUIÇÃO de preços BAIXOS (fixar o piso de centavo)');
await tab(`SELECT
  SUM(preco<=0.01) AS ate_0_01, SUM(preco>0.01 AND preco<0.50) AS de_0_01_a_0_50,
  SUM(preco>=0.50 AND preco<1.00) AS de_0_50_a_1, SUM(preco>=1 AND preco<2) AS de_1_a_2
 FROM catalogo_produto WHERE moeda='BRL' AND preco>0`);
console.log('  amostra dos <0,50:');
await tab(`SELECT fonte, ean, LEFT(nome,38) nome, preco FROM catalogo_produto WHERE moeda='BRL' AND preco>0 AND preco<0.50 ORDER BY preco LIMIT 12`);

hr('PART 2.2c — CONTAGENS por tabela (sentinela = {99999,999999,9999999}; piso = <0,50)');
console.log('\n[catalogo_produto] — por escopo:');
await tab(`SELECT 'TODAS BRL' escopo,
   SUM(preco IN(99999,999999,9999999)) sentinela, SUM(preco>0 AND preco<0.50) centavo
   FROM catalogo_produto WHERE moeda='BRL' AND preco IS NOT NULL`);
await tab(`SELECT 'SÓ FARMÁCIA' escopo,
   SUM(preco IN(99999,999999,9999999)) sentinela, SUM(preco>0 AND preco<0.50) centavo
   FROM catalogo_produto WHERE moeda='BRL' AND preco IS NOT NULL AND fonte IN ${inFarm}`, FARM);
console.log('\n[catalogo_produto] sentinela por fonte (quem mais vazou):');
await tab(`SELECT fonte, COUNT(*) n FROM catalogo_produto WHERE preco IN(99999,999999,9999999) GROUP BY fonte ORDER BY n DESC LIMIT 12`);

console.log('\n[catalogo_preco_hist]:');
await tab(`SELECT SUM(preco IN(99999,999999,9999999)) sentinela, SUM(preco>0 AND preco<0.50) centavo, COUNT(*) total_brl
   FROM catalogo_preco_hist WHERE moeda='BRL'`);

console.log('\n[medicamento_monitor_hist] (preco e preco_cond):');
await tab(`SELECT
   SUM(preco IN(99999,999999,9999999)) preco_sentinela, SUM(preco>0 AND preco<0.50) preco_centavo,
   SUM(preco_cond IN(99999,999999,9999999)) cond_sentinela, SUM(preco_cond>0 AND preco_cond<0.50) cond_centavo,
   COUNT(*) total FROM medicamento_monitor_hist`);

await closePool();
console.log('\n── FIM DO DRY-RUN (nada foi alterado)');

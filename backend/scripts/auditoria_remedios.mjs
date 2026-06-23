// AUDITORIA DE CONFIABILIDADE — vertical de medicamentos. SOMENTE SELECT (read-only).
// Corre no servidor: sudo -u dev node --env-file=.env scripts/auditoria_remedios.mjs
import { getPool, closePool } from '../src/db.js';
const pool = getPool();
const GLP1 = 'SEMAGLUTIDA|TIRZEPATIDA|LIRAGLUTIDA';
const hr = (s) => console.log('\n' + '═'.repeat(78) + '\n' + s + '\n' + '═'.repeat(78));
const sub = (s) => console.log('\n── ' + s);
async function tab(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  if (!rows.length) { console.log('  (sem linhas)'); return rows; }
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  console.log('  ' + cols.map((c, i) => c.padEnd(w[i])).join(' | '));
  for (const r of rows) console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join(' | '));
  return rows;
}

hr('0. DENOMINADORES');
await tab(`SELECT
  (SELECT COUNT(*) FROM catalogo_produto WHERE preco>0 AND moeda='BRL') AS ofertas_com_preco,
  (SELECT COUNT(DISTINCT ean) FROM catalogo_produto WHERE preco>0 AND moeda='BRL') AS eans_com_preco,
  (SELECT COUNT(DISTINCT fonte) FROM catalogo_produto WHERE preco>0) AS fontes_com_preco,
  (SELECT COUNT(*) FROM medicamento) AS itens_identidade,
  (SELECT MIN(visto_em) FROM catalogo_preco_hist) AS hist_inicio,
  (SELECT MAX(visto_em) FROM catalogo_preco_hist) AS hist_fim`);

hr('A. IDENTIDADE');
sub('A.1 ÓRFÃOS (oferta BRL com preço, sem match por EAN na medicamento)');
await tab(`SELECT COUNT(DISTINCT cp.ean) AS eans_orfaos, COUNT(*) AS linhas_orfas
  FROM catalogo_produto cp LEFT JOIN medicamento m ON m.ean=cp.ean
  WHERE cp.preco>0 AND cp.moeda='BRL' AND m.ean IS NULL`);
sub('A.2 Órfãos por fonte (onde a casagem por EAN mais falha)');
await tab(`SELECT cp.fonte, COUNT(DISTINCT cp.ean) AS eans,
   COUNT(DISTINCT CASE WHEN m.ean IS NULL THEN cp.ean END) AS eans_sem_id,
   ROUND(100*COUNT(DISTINCT CASE WHEN m.ean IS NULL THEN cp.ean END)/NULLIF(COUNT(DISTINCT cp.ean),0),1) AS pct_orfaos
  FROM catalogo_produto cp LEFT JOIN medicamento m ON m.ean=cp.ean
  WHERE cp.preco>0 AND cp.moeda='BRL' GROUP BY cp.fonte ORDER BY pct_orfaos DESC`);
sub('A.3 [CRÍTICO] COLAPSO DE FORÇA — baldes de equivalência GLP-1 (eans_no_balde>1 = agrupa forças diferentes)');
await tab(`SELECT m.substancia, m.dose_valor, m.dose_unidade, m.forma,
   COUNT(DISTINCT m.ean) AS eans_no_balde, COUNT(DISTINCT m.registro) AS registros_no_balde
  FROM medicamento m WHERE m.substancia REGEXP ?
  GROUP BY m.substancia,m.dose_valor,m.dose_unidade,m.forma ORDER BY eans_no_balde DESC`, [GLP1]);
sub('A.4 [SONDA] a força clínica está no campo OFICIAL apresentacao? (amostra)');
await tab(`SELECT m.ean, LEFT(m.produto,22) AS produto, m.dose_valor AS dv, m.dose_unidade AS du, m.qtd_embalagem AS qtd,
   LEFT(m.apresentacao,60) AS apresentacao, (m.raw IS NOT NULL) AS tem_raw
  FROM medicamento m WHERE m.substancia REGEXP ? ORDER BY m.substancia,m.produto,m.qtd_embalagem LIMIT 14`, [GLP1]);
sub('A.6 Variantes de grafia da molécula (match é string-exato)');
await tab(`SELECT m.substancia, COUNT(DISTINCT m.ean) AS eans, COUNT(DISTINCT m.registro) AS registros
  FROM medicamento m WHERE m.substancia REGEXP ? GROUP BY m.substancia ORDER BY m.substancia`, [GLP1]);

hr('B. PREÇO');
sub('B.1 Quais fontes preenchem preco_cond');
await tab(`SELECT fonte, COUNT(*) AS linhas, SUM(preco_cond IS NOT NULL) AS com_cond,
   ROUND(100*SUM(preco_cond IS NOT NULL)/NULLIF(COUNT(*),0),1) AS pct_cond
  FROM catalogo_produto WHERE preco>0 AND moeda='BRL' GROUP BY fonte ORDER BY pct_cond DESC`);
sub('B.2 Magnitude do desconto condicional + anomalias');
await tab(`SELECT fonte, COUNT(*) AS pares, ROUND(AVG(100*(preco-preco_cond)/NULLIF(preco,0)),1) AS desc_medio_pct,
   ROUND(MAX(100*(preco-preco_cond)/NULLIF(preco,0)),1) AS desc_max_pct, SUM(preco_cond>preco) AS cond_maior_q_preco
  FROM catalogo_produto WHERE preco>0 AND preco_cond>0 AND moeda='BRL' GROUP BY fonte ORDER BY desc_medio_pct DESC`);
sub('B.3 [CRÍTICO] Preços ACIMA do teto legal (PMC)');
await tab(`SELECT SUM(cp.preco>m.pmc_18) AS acima_teto, COUNT(*) AS com_pmc,
   ROUND(100*SUM(cp.preco>m.pmc_18)/NULLIF(COUNT(*),0),2) AS pct_acima
  FROM catalogo_produto cp JOIN medicamento m ON m.ean=cp.ean
  WHERE cp.preco>0 AND cp.moeda='BRL' AND m.pmc_18>0`);
sub('B.3b Piores ofensores acima do teto');
await tab(`SELECT cp.fonte, cp.ean, LEFT(cp.nome,34) AS nome, cp.preco, m.pmc_18,
   ROUND(100*(cp.preco-m.pmc_18)/NULLIF(m.pmc_18,0),1) AS pct_acima
  FROM catalogo_produto cp JOIN medicamento m ON m.ean=cp.ean
  WHERE cp.preco>0 AND cp.moeda='BRL' AND m.pmc_18>0 AND cp.preco>m.pmc_18 ORDER BY pct_acima DESC LIMIT 15`);
sub('B.4 Preços suspeitosamente BAIXOS (<50% do teto) — condicional gravado como normal?');
await tab(`SELECT cp.fonte, cp.ean, LEFT(cp.nome,34) AS nome, cp.preco, m.pmc_18,
   ROUND(100*cp.preco/NULLIF(m.pmc_18,0),1) AS pct_do_teto
  FROM catalogo_produto cp JOIN medicamento m ON m.ean=cp.ean
  WHERE cp.preco>0 AND cp.moeda='BRL' AND m.pmc_18>0 AND cp.preco<0.5*m.pmc_18 ORDER BY pct_do_teto ASC LIMIT 15`);
sub('B.5 Saltos suspeitos no histórico on-change (razao>=1.25)');
await tab(`SELECT fonte, ean, COUNT(*) AS obs, MIN(preco) AS pmin, MAX(preco) AS pmax,
   ROUND(MAX(preco)/NULLIF(MIN(preco),0),2) AS razao
  FROM catalogo_preco_hist WHERE moeda='BRL' AND preco>0 GROUP BY fonte,ean
  HAVING obs>=2 AND razao>=1.25 ORDER BY razao DESC LIMIT 20`);

hr('C. FRESCOR E COBERTURA');
sub('C.1 Idade dos preços atuais dos remédios');
await tab(`SELECT
   SUM(TIMESTAMPDIFF(HOUR,cp.scraped_at,NOW())<=6) AS ate_6h,
   SUM(TIMESTAMPDIFF(HOUR,cp.scraped_at,NOW()) BETWEEN 7 AND 24) AS h7_24,
   SUM(TIMESTAMPDIFF(HOUR,cp.scraped_at,NOW()) BETWEEN 25 AND 168) AS d1_7,
   SUM(TIMESTAMPDIFF(HOUR,cp.scraped_at,NOW())>168) AS mais_7d, COUNT(*) AS total
  FROM catalogo_produto cp JOIN medicamento m ON m.ean=cp.ean WHERE cp.preco>0 AND cp.moeda='BRL'`);
sub('C.2 Saúde por fonte: volume + última coleta (fonte morta calada?)');
await tab(`SELECT cp.fonte, COUNT(*) AS ofertas_med, MAX(cp.scraped_at) AS ultima,
   TIMESTAMPDIFF(HOUR,MAX(cp.scraped_at),NOW()) AS horas_desde
  FROM catalogo_produto cp JOIN medicamento m ON m.ean=cp.ean
  WHERE cp.preco>0 AND cp.moeda='BRL' GROUP BY cp.fonte ORDER BY horas_desde DESC`);

hr('D. DISPONIBILIDADE (estoque)');
sub('D.1 Distribuição dos valores de estoque no monitor denso');
await tab(`SELECT SUM(disponivel IS NULL) AS disp_null,
   SUM(disponivel=1 AND qtd_estoque=99999) AS disp1_sentinela,
   SUM(disponivel=1 AND qtd_estoque BETWEEN 1 AND 99998) AS disp1_real,
   SUM(disponivel=1 AND qtd_estoque IS NULL) AS disp1_qtdnull,
   SUM(disponivel=0) AS indisponivel, COUNT(*) AS total FROM medicamento_monitor_hist`);
sub('D.2 Sinal de estoque por fonte');
await tab(`SELECT fonte, SUM(disponivel IS NOT NULL) AS com_sinal, SUM(qtd_estoque BETWEEN 1 AND 99998) AS com_qtd_real, COUNT(*) AS linhas
  FROM medicamento_monitor_hist GROUP BY fonte ORDER BY com_sinal DESC`);

await closePool();
console.log('\n── FIM DA AUDITORIA');

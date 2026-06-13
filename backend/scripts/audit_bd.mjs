// AUDITORIA DE BD (one-off, SÓ LEITURA): tamanhos, índices reais, distribuição de
// EANs entre fontes, e EXPLAIN das queries quentes. Verdade do servidor p/ a análise.
//   sudo -u dev node --env-file=.env scripts/audit_bd.mjs
import { getPool } from '../src/db.js';
const pool = getPool();
const q = async (s, p = []) => (await pool.query(s, p))[0];

console.log('\n══════════ 1. TABELAS (tamanho desc) ══════════');
const tabs = await q(`SELECT table_name n, table_rows rows_aprox,
  ROUND(data_length/1048576,1) data_mb, ROUND(index_length/1048576,1) idx_mb, engine
  FROM information_schema.tables WHERE table_schema=DATABASE()
  ORDER BY data_length+index_length DESC`);
for (const t of tabs) console.log(`  ${t.n.padEnd(22)} ~${String(t.rows_aprox).padStart(8)} linhas · ${String(t.data_mb).padStart(7)}MB dados · ${String(t.idx_mb).padStart(6)}MB idx`);

console.log('\n══════════ 2. ÍNDICES (tabelas quentes) ══════════');
const tabsQuentes = ['item', 'catalogo_produto', 'produto_ean', 'off_produto', 'sku_normalizado', 'produto_mestre', 'produto_generico', 'fatura', 'loja', 'lista_item', 'despensa'];
for (const tab of tabsQuentes) {
  const idx = await q(`SELECT index_name nm, GROUP_CONCAT(column_name ORDER BY seq_in_index) cols, non_unique nu
    FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? GROUP BY index_name`, [tab]).catch(() => null);
  if (!idx) { console.log(`  ${tab}: (não existe?)`); continue; }
  console.log(`  ${tab}:`);
  for (const i of idx) console.log(`      ${i.nu ? ' ' : 'U'} ${i.nm.padEnd(20)} (${i.cols})`);
}

console.log('\n══════════ 3. EANs POR FONTE / TABELA ══════════');
const por = async (label, sql, p = []) => { try { const [[r]] = await pool.query(sql, p); console.log(`  ${label.padEnd(42)} ${String(r.n).padStart(8)}`); } catch (e) { console.log(`  ${label}: ERRO ${e.message}`); } };
await por('catalogo_produto: linhas com EAN', `SELECT COUNT(*) n FROM catalogo_produto WHERE ean IS NOT NULL AND ean<>''`);
await por('catalogo_produto: EANs DISTINTOS', `SELECT COUNT(DISTINCT ean) n FROM catalogo_produto WHERE ean IS NOT NULL AND ean<>''`);
const fontes = await q(`SELECT fonte, COUNT(DISTINCT ean) n FROM catalogo_produto WHERE ean IS NOT NULL AND ean<>'' GROUP BY fonte ORDER BY n DESC`);
for (const f of fontes) console.log(`      └ ${String(f.fonte).padEnd(20)} ${String(f.n).padStart(8)} EANs distintos`);
await por('off_produto: EANs distintos', `SELECT COUNT(DISTINCT code) n FROM off_produto`).catch(() => por('off_produto (code?)', `SELECT COUNT(*) n FROM off_produto`));
await por('produto_ean: EANs (fichas locais)', `SELECT COUNT(DISTINCT ean) n FROM produto_ean`);
await por('item: EANs distintos no talão', `SELECT COUNT(DISTINCT ean) n FROM item WHERE ean IS NOT NULL AND ean<>''`);

console.log('\n══════════ 4. SOBREPOSIÇÃO catálogo × OFF (a hipótese do dono) ══════════');
// quantos EANs do catálogo NÃO estão no OFF e vice-versa — mede a fragmentação
await por('EANs SÓ no catálogo (não no OFF)', `SELECT COUNT(*) n FROM (SELECT DISTINCT ean FROM catalogo_produto WHERE ean<>'' AND ean IS NOT NULL) c LEFT JOIN off_produto o ON o.code=c.ean WHERE o.code IS NULL`).catch((e) => console.log('   (off code col?)', e.message));
await por('EANs em VÁRIAS fontes do catálogo', `SELECT COUNT(*) n FROM (SELECT ean FROM catalogo_produto WHERE ean<>'' AND ean IS NOT NULL GROUP BY ean HAVING COUNT(DISTINCT fonte)>=2) x`);

console.log('\n══════════ 5. EXPLAIN das queries quentes ══════════');
const explain = async (label, sql, p = []) => {
  try { const r = await q('EXPLAIN ' + sql, p); const e = r[0]; console.log(`  ${label}\n      type=${e.type} key=${e.key || 'NENHUM!'} rows≈${e.rows} ${e.Extra || ''}`); }
  catch (e) { console.log(`  ${label}: ERRO ${e.message}`); }
};
await explain('item WHERE sku_id=?', 'SELECT id FROM item WHERE sku_id=?', [1]);
await explain('item WHERE fatura_id=?', 'SELECT id FROM item WHERE fatura_id=?', [1]);
await explain('item WHERE ean=?', 'SELECT id FROM item WHERE ean=?', ['5601234567890']);
await explain('catalogo WHERE nome LIKE ?', `SELECT id FROM catalogo_produto WHERE nome LIKE ?`, ['%tomate%']);
await explain('sku WHERE nome_canonico LIKE ?', `SELECT id FROM sku_normalizado WHERE nome_canonico LIKE ?`, ['%iogurte%']);

await pool.end();
console.log('\n(fim)');

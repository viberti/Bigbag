// DIAGNÓSTICO da base de dados (SÓ LEITURA): varre as inconsistências típicas e
// imprime contagens + amostras. Não altera nada. Reutilizável — correr após
// grandes mudanças ou periodicamente.
//   node scripts/diagnostico_bd.mjs
import { getPool } from '../src/db.js';
import { eanValido } from '../src/ingest/produto.js';

const pool = getPool();
const achados = [];
async function check(titulo, sql, params = [], { amostra = (r) => JSON.stringify(r), max = 3 } = {}) {
  try {
    const [rows] = await pool.query(sql, params);
    if (rows.length) {
      achados.push({ titulo, n: rows.length, amostras: rows.slice(0, max).map(amostra) });
      console.log(`✗ ${titulo}: ${rows.length}`);
      rows.slice(0, max).forEach((r) => console.log(`    · ${amostra(r)}`));
    } else {
      console.log(`✓ ${titulo}: 0`);
    }
  } catch (e) {
    console.log(`! ${titulo}: ERRO ${e.message}`);
  }
}

console.log('— REFERÊNCIAS ÓRFÃS —');
await check('sku_alias → SKU inexistente',
  'SELECT a.id, a.descricao_original, a.sku_id FROM sku_alias a LEFT JOIN sku_normalizado s ON s.id=a.sku_id WHERE s.id IS NULL',
  [], { amostra: (r) => `alias ${r.id} "${r.descricao_original}" → sku ${r.sku_id}` });
await check('produto_nome → SKU inexistente',
  'SELECT pn.id, pn.nome, pn.sku_id FROM produto_nome pn LEFT JOIN sku_normalizado s ON s.id=pn.sku_id WHERE pn.sku_id IS NOT NULL AND s.id IS NULL',
  [], { amostra: (r) => `pn ${r.id} "${r.nome}" → sku ${r.sku_id}` });
await check('produto_generico → SKU inexistente',
  'SELECT pg.sku_id, pg.alimento FROM produto_generico pg LEFT JOIN sku_normalizado s ON s.id=pg.sku_id WHERE s.id IS NULL',
  [], { amostra: (r) => `generico sku ${r.sku_id} (${r.alimento})` });
await check('produto_ean.item_id → item inexistente',
  'SELECT pe.id, pe.ean, pe.item_id FROM produto_ean pe LEFT JOIN item i ON i.id=pe.item_id WHERE pe.item_id IS NOT NULL AND i.id IS NULL',
  [], { amostra: (r) => `pe ${r.id} ean=${r.ean} → item ${r.item_id}` });
await check('produto_ean.sku_id → SKU inexistente',
  'SELECT pe.id, pe.ean, pe.sku_id FROM produto_ean pe LEFT JOIN sku_normalizado s ON s.id=pe.sku_id WHERE pe.sku_id IS NOT NULL AND s.id IS NULL',
  [], { amostra: (r) => `pe ${r.id} ean=${r.ean} → sku ${r.sku_id}` });
await check('item.sku_id → SKU inexistente',
  'SELECT i.id, i.descricao_original, i.sku_id FROM item i LEFT JOIN sku_normalizado s ON s.id=i.sku_id WHERE i.sku_id IS NOT NULL AND s.id IS NULL',
  [], { amostra: (r) => `item ${r.id} "${r.descricao_original}" → sku ${r.sku_id}` });
await check('produto_analise (sku:N) → SKU inexistente',
  "SELECT pa.ean FROM produto_analise pa LEFT JOIN sku_normalizado s ON s.id = CAST(SUBSTRING(pa.ean,5) AS UNSIGNED) WHERE pa.ean LIKE 'sku:%' AND s.id IS NULL",
  [], { amostra: (r) => r.ean });
await check('produto_foto → item inexistente',
  'SELECT pf.id, pf.item_id FROM produto_foto pf LEFT JOIN item i ON i.id=pf.item_id WHERE pf.item_id IS NOT NULL AND i.id IS NULL',
  [], { amostra: (r) => `foto ${r.id} → item ${r.item_id}` });

console.log('\n— SKUs —');
await check('SKUs duplicados por nome normalizado (candidatos a fusão)',
  `SELECT LOWER(CONVERT(nome_canonico USING ascii)) AS k, COUNT(*) n, GROUP_CONCAT(CONCAT(id,':',nome_canonico) SEPARATOR ' | ') AS quais
     FROM sku_normalizado GROUP BY k HAVING n > 1`,
  [], { amostra: (r) => r.quais });
await check('SKUs órfãos (sem itens, sem alias, sem ficha, sem genérico)',
  `SELECT s.id, s.nome_canonico FROM sku_normalizado s
    WHERE NOT EXISTS (SELECT 1 FROM item i WHERE i.sku_id=s.id)
      AND NOT EXISTS (SELECT 1 FROM sku_alias a WHERE a.sku_id=s.id)
      AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.sku_id=s.id)
      AND NOT EXISTS (SELECT 1 FROM produto_generico pg WHERE pg.sku_id=s.id)`,
  [], { amostra: (r) => `${r.id}: ${r.nome_canonico}`, max: 5 });
await check('SKU com unidade_base em conflito com itens a peso (kg/L com itens un e vice-versa) — info',
  `SELECT s.id, s.nome_canonico, s.unidade_base, SUM(i.linha_peso IS NOT NULL) AS com_peso, COUNT(*) AS n
     FROM sku_normalizado s JOIN item i ON i.sku_id=s.id
    GROUP BY s.id HAVING (s.unidade_base='un' AND com_peso>0)`,
  [], { amostra: (r) => `${r.nome_canonico} (${r.unidade_base}) tem ${r.com_peso}/${r.n} itens com linha de peso` });

console.log('\n— EANs —');
const validar = async (titulo, sql, campo) => {
  const [rows] = await pool.query(sql);
  const maus = rows.filter((r) => r[campo] && !eanValido(String(r[campo])));
  if (maus.length) {
    console.log(`✗ ${titulo}: ${maus.length}`);
    maus.slice(0, 5).forEach((r) => console.log(`    · ${JSON.stringify(r)}`));
    achados.push({ titulo, n: maus.length });
  } else console.log(`✓ ${titulo}: 0`);
};
await validar('item.ean INVÁLIDO (dígito verificador)', 'SELECT id, descricao_original, ean FROM item WHERE ean IS NOT NULL', 'ean');
await validar('produto_ean.ean INVÁLIDO', 'SELECT id, nome, ean FROM produto_ean WHERE ean IS NOT NULL', 'ean');
await check('item.ean sem ficha correspondente em produto_ean',
  `SELECT i.id, i.descricao_original, i.ean FROM item i
    WHERE i.ean IS NOT NULL AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.ean=i.ean)`,
  [], { amostra: (r) => `item ${r.id} "${r.descricao_original}" ean=${r.ean}` });
await check('produto_ean duplicado por item (linhas ean NULL acumuladas)',
  `SELECT item_id, COUNT(*) n FROM produto_ean WHERE ean IS NULL AND item_id IS NOT NULL GROUP BY item_id HAVING n>1`,
  [], { amostra: (r) => `item ${r.item_id}: ${r.n} fichas sem EAN` });
await check('fichas sem nome (produto_ean com ean mas nome NULL/vazio)',
  "SELECT id, ean, fonte FROM produto_ean WHERE ean IS NOT NULL AND (nome IS NULL OR nome='')",
  [], { amostra: (r) => `pe ${r.id} ean=${r.ean} fonte=${r.fonte}` });
await check('nutrição vlm-only marcada confirmada=1 (escapou ao isolamento)',
  'SELECT id, ean, nome FROM produto_ean WHERE nutricao IS NOT NULL AND off_json IS NULL AND vlm_json IS NOT NULL AND nutricao_confirmada=1',
  [], { amostra: (r) => `pe ${r.id} ${r.ean || '(s/ean)'} ${r.nome}` });

console.log('\n— ITENS / PREÇOS —');
await check('quantidade inválida (<=0)',
  'SELECT id, descricao_original, quantidade FROM item WHERE quantidade <= 0',
  [], { amostra: (r) => `item ${r.id} "${r.descricao_original}" qtd=${r.quantidade}` });
await check('preço negativo (fora de desconto/clearance)',
  'SELECT id, descricao_original, preco_liquido FROM item WHERE preco_liquido < 0 AND is_clearance=0',
  [], { amostra: (r) => `item ${r.id} "${r.descricao_original}" €${r.preco_liquido}` });
await check('ppb incoerente p/ unidade UN (|ppb×qtd − preço| > 0,05, sem inferido)',
  `SELECT i.id, i.descricao_original, i.quantidade, i.preco_liquido, i.preco_por_base
     FROM item i JOIN sku_normalizado s ON s.id=i.sku_id
    WHERE s.unidade_base='un' AND i.preco_por_base IS NOT NULL AND i.ppb_inferido=0 AND i.quantidade>0
      AND ABS(i.preco_por_base*i.quantidade - i.preco_liquido) > 0.05`,
  [], { amostra: (r) => `item ${r.id} "${r.descricao_original}" ${r.quantidade}×ppb ${r.preco_por_base} ≠ €${r.preco_liquido}`, max: 5 });
await check('peso_em_falta=1 MAS com preco_por_base (contraditório)',
  'SELECT id, descricao_original FROM item WHERE peso_em_falta=1 AND preco_por_base IS NOT NULL',
  [], { amostra: (r) => `item ${r.id} "${r.descricao_original}"` });
await check('itens sem SKU (não-resolvidos, excl. não-produto)',
  'SELECT COUNT(*) AS n FROM item WHERE sku_id IS NULL AND is_non_product=0 HAVING n>0',
  [], { amostra: (r) => `${r.n} itens` });

console.log('\n— FATURAS / LOJAS —');
await check('lojas duplicadas por nome (mesma loja, linhas distintas)',
  `SELECT LOWER(nome) k, COUNT(*) n, GROUP_CONCAT(CONCAT(id,':',nome,'/',IFNULL(cadeia,'-')) SEPARATOR ' | ') quais
     FROM loja GROUP BY k HAVING n>1`,
  [], { amostra: (r) => r.quais });
await check('faturas com discrepância >0,05 SEM needs_review',
  'SELECT id, total_impresso, discrepancia FROM fatura WHERE ABS(IFNULL(discrepancia,0))>0.05 AND needs_review=0',
  [], { amostra: (r) => `fatura ${r.id} total=${r.total_impresso} disc=${r.discrepancia}` });
await check('faturas em needs_review (pendentes de revisão) — info',
  'SELECT id, data_compra, total_impresso, discrepancia FROM fatura WHERE needs_review=1 ORDER BY id',
  [], { amostra: (r) => `fatura ${r.id} ${String(r.data_compra).slice(0, 10)} €${r.total_impresso} disc=${r.discrepancia}`, max: 5 });
await check('possíveis faturas duplicadas (cadeia+data+total) — info',
  `SELECT COALESCE(l.cadeia,l.nome) c, DATE(f.data_compra) d, f.total_impresso t, COUNT(*) n, GROUP_CONCAT(f.id) ids
     FROM fatura f JOIN loja l ON l.id=f.loja_id GROUP BY c, d, t HAVING n>1`,
  [], { amostra: (r) => `${r.c} ${r.d} €${r.t} → faturas ${r.ids}` });
await check('faturas com data no futuro',
  'SELECT id, data_compra FROM fatura WHERE data_compra > NOW()',
  [], { amostra: (r) => `fatura ${r.id} ${r.data_compra}` });

console.log('\n— produto_nome / CATÁLOGO —');
const [pnAmb] = await pool.query(
  `SELECT nome, COUNT(DISTINCT ean) n FROM produto_nome WHERE ean IS NOT NULL GROUP BY nome HAVING n>1`);
console.log(`i nomes ligados a VÁRIOS EANs (ambíguos por natureza — informativo): ${pnAmb.length}`);
await check('produto_nome com EAN sem ficha',
  `SELECT pn.id, pn.nome, pn.ean FROM produto_nome pn
    WHERE pn.ean IS NOT NULL AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.ean=pn.ean)`,
  [], { amostra: (r) => `pn ${r.id} "${r.nome}" ean=${r.ean}`, max: 5 });
await check('catálogo: nome vazio com EAN',
  "SELECT id, fonte, ean FROM catalogo_produto WHERE ean IS NOT NULL AND (nome IS NULL OR nome='')",
  [], { amostra: (r) => `cat ${r.id} ${r.fonte} ean=${r.ean}` });

console.log(`\n=== RESUMO: ${achados.length} categoria(s) com achados ===`);
await pool.end();

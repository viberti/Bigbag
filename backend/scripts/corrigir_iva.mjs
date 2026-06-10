// A5 (Analise_Fontes §2.1) — corrige taxas de IVA mal lidas pelo VLM, por
// redundância ENTRE COMPRAS e ENTRE CAMPOS. Dry-run por omissão; --aplicar executa.
//   Regra 1 — voto maioritário por SKU: o mesmo produto tem a mesma taxa; com ≥3
//     itens e maioria ≥2/3, os divergentes são erro de legenda (banana a 23%).
//   Regra 2 — fresco a 23%: fruta/legume/carne/peixe FRESCOS são taxa reduzida em
//     Portugal (Lista I CIVA); um fresco (produto_generico.tipo='fresco') a 23% é
//     erro de leitura → 6%. (Secos/desidratados são 'processado' — não são tocados.)
// Nota: taxa só afeta o ppb no grossista (precos_com_iva=0) — recomputa essas faturas.
import { getPool } from '../src/db.js';
import { recomputarPpbFatura } from '../src/normaliza/ppb.js';

const APLICAR = process.argv.includes('--aplicar');
const pool = getPool();
const correcoes = []; // { item, desc, de, para, regra }

// Regra 1 — voto maioritário por SKU
const [skus] = await pool.query(`
  SELECT i.sku_id, i.taxa_iva, COUNT(*) n
    FROM item i WHERE i.sku_id IS NOT NULL AND i.taxa_iva IS NOT NULL AND i.is_non_product = 0
   GROUP BY i.sku_id, i.taxa_iva`);
const porSku = new Map();
for (const r of skus) {
  (porSku.get(r.sku_id) || porSku.set(r.sku_id, []).get(r.sku_id)).push(r);
}
for (const [skuId, taxas] of porSku) {
  if (taxas.length < 2) continue;
  const total = taxas.reduce((s, t) => s + t.n, 0);
  if (total < 3) continue;
  taxas.sort((a, b) => b.n - a.n);
  const moda = taxas[0];
  if (moda.n / total < 2 / 3) continue; // sem maioria clara → não mexe
  const [outliers] = await pool.query(
    'SELECT i.id, i.descricao_original, i.taxa_iva FROM item i WHERE i.sku_id = ? AND i.taxa_iva IS NOT NULL AND i.taxa_iva <> ?',
    [skuId, moda.taxa_iva],
  );
  for (const o of outliers) correcoes.push({ item: o.id, desc: o.descricao_original, de: o.taxa_iva, para: moda.taxa_iva, regra: 'maioria-sku' });
}

// Regra 2 — fresco a 23%: SÓ RELATÓRIO. A evidência é fraca demais para corrigir
// sozinha: o disparo depende do produto_generico.tipo, que tem erros (amêndoas,
// feijão cozido, tomate em conserva e gelo estão marcados 'fresco' — são
// processados, e o 23% impresso pode ser legítimo). O operador decide; quando o
// caso é real (carne fresca), a regra 1 apanha-o assim que houver 2.ª compra.
const ja = new Set(correcoes.map((c) => c.item));
const [frescos] = await pool.query(`
  SELECT i.id, i.descricao_original, i.taxa_iva
    FROM item i JOIN produto_generico pg ON pg.sku_id = i.sku_id
   WHERE pg.tipo = 'fresco' AND i.taxa_iva = 0.23 AND i.is_non_product = 0`);
const suspeitos = frescos.filter((f) => !ja.has(f.id));
if (suspeitos.length) {
  console.log(`Suspeitos (fresco a 23% — rever no admin; pode ser o IVA OU a classificação fresco/processado):`);
  for (const f of suspeitos) console.log(`  ? item ${f.id} "${f.descricao_original}"`);
  console.log('');
}

if (!correcoes.length) { console.log('IVA consistente — nada a corrigir. ✓'); await pool.end(); process.exit(0); }
console.log(`${APLICAR ? 'A APLICAR' : 'DRY-RUN'} — ${correcoes.length} correções de IVA:\n`);
for (const c of correcoes) console.log(`  • item ${c.item} "${c.desc}": ${Number(c.de) * 100}% → ${Number(c.para) * 100}% (${c.regra})`);

if (APLICAR) {
  const faturas = new Set();
  for (const c of correcoes) {
    await pool.query('UPDATE item SET taxa_iva = ? WHERE id = ?', [c.para, c.item]);
    const [[f]] = await pool.query(
      'SELECT f.id FROM fatura f JOIN item i ON i.fatura_id = f.id WHERE i.id = ? AND f.precos_com_iva = 0', [c.item]);
    if (f) faturas.add(f.id);
  }
  for (const fid of faturas) await recomputarPpbFatura(pool, fid); // taxa entra no ppb do grossista
  console.log(`\nAplicadas ${correcoes.length} correções (${faturas.size} faturas grossista recomputadas). ✓`);
} else {
  console.log('\n(dry-run — corre com --aplicar para executar)');
}
await pool.end();

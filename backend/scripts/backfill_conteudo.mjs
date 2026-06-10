// A1 (Analise_Fontes §3.1) — backfill do conteúdo da embalagem + cadeia do ppb.
//   node scripts/backfill_conteudo.mjs            ← passo 1 + dry-run dos passos 2-3
//   node scripts/backfill_conteudo.mjs --aplicar  ← tudo
// Passos (idempotente):
//   1. parseia `quantidade` (texto) de TODAS as fichas → conteudo_valor/unidade/pack
//   2. SKUs com unidade 'un' cujos itens têm ficha (via EAN) a declarar kg/L
//      → flip da unidade de comparação (exceto categorias contadas: ovos/sabonete)
//   3. recomputa o ppb de todos os SKUs com itens ligados a fichas com conteúdo
import { getPool } from '../src/db.js';
import { conteudoDeTexto } from '../src/normaliza/conteudo.js';
import { recomputarPpbSku } from '../src/normaliza/ppb.js';

const APLICAR = process.argv.includes('--aplicar');
const CONTADAS = /\bovos?\b|d[uú]zia|sabonete/i;
const pool = getPool();

// 1 — conteúdo estruturado em todas as fichas
const [fichas] = await pool.query("SELECT id, quantidade FROM produto_ean WHERE quantidade IS NOT NULL AND quantidade <> ''");
let preenchidas = 0;
for (const f of fichas) {
  const c = conteudoDeTexto(f.quantidade);
  await pool.query('UPDATE produto_ean SET conteudo_valor = ?, conteudo_unidade = ?, conteudo_pack = ? WHERE id = ?', [
    c?.valor ?? null, c?.unidade ?? null, c?.pack ?? null, f.id,
  ]);
  if (c) preenchidas++;
}
console.log(`1) conteúdo: ${preenchidas}/${fichas.length} fichas com texto parseável → colunas preenchidas`);

// 2 — flip de unidade dos SKUs 'un' com evidência kg/L na ficha
const [cands] = await pool.query(`
  SELECT s.id, s.nome_canonico, GROUP_CONCAT(DISTINCT pe.conteudo_unidade) AS us, COUNT(DISTINCT i.id) AS itens
    FROM sku_normalizado s
    JOIN item i ON i.sku_id = s.id AND i.ean IS NOT NULL
    JOIN produto_ean pe ON pe.ean = i.ean AND pe.conteudo_unidade IN ('kg','L')
   WHERE s.unidade_base = 'un'
   GROUP BY s.id`);
const flips = cands.filter((c) => !c.us.includes(',') && !CONTADAS.test(c.nome_canonico));
console.log(`\n2) flip de unidade (${APLICAR ? 'A APLICAR' : 'dry-run'}): ${flips.length} SKUs`);
for (const c of flips) console.log(`   · #${c.id} "${c.nome_canonico}": un → ${c.us} (${c.itens} item/ns com ficha)`);
if (APLICAR) for (const c of flips) await pool.query('UPDATE sku_normalizado SET unidade_base = ? WHERE id = ?', [c.us, c.id]);

// 3 — recompute do ppb de todos os SKUs com itens ligados a fichas com conteúdo
if (APLICAR) {
  const [skus] = await pool.query(`
    SELECT DISTINCT i.sku_id FROM item i JOIN produto_ean pe ON pe.ean = i.ean
     WHERE i.sku_id IS NOT NULL AND pe.conteudo_valor IS NOT NULL`);
  let n = 0;
  for (const { sku_id } of skus) n += await recomputarPpbSku(pool, sku_id);
  console.log(`\n3) ppb recomputado: ${skus.length} SKUs / ${n} itens`);
} else {
  console.log('\n(3 — recompute só com --aplicar)');
}
await pool.end();

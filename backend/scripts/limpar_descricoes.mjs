// Backfill: limpa o RUÍDO (qtd/peso/preço/IVA) das descrições já guardadas.
// A informação não se perde — qtd/peso/preço estão nas colunas estruturadas
// (quantidade, linha_peso, preco_*). Antes de tirar o peso do nome, preserva-o
// em linha_peso (reprocess.js calcula o €/kg de descricao_original+linha_peso).
// Funde aliases que, depois de limpos, colidem (sku_alias.descricao_original é UNIQUE).
// Dissocia o mamão ("MANAO PARTIDO") agrupado por engano na Banana.
//
// Uso:  node --env-file=.env scripts/limpar_descricoes.mjs          (preview, não escreve)
//       node --env-file=.env scripts/limpar_descricoes.mjs --apply  (aplica)
import { getPool } from '../src/db.js';
import { limparDescricao } from '../src/normaliza/mestre.js';

const APPLY = process.argv.includes('--apply');
const RE_TEM_PESO = /\d+[.,]\d+\s*kg|kg\s*[x×X]\s*\d|eur\s*\/\s*kg|€\s*\/\s*kg/i;
const db = getPool();
const log = (...a) => console.log(...a);
log(APPLY ? '=== MODO APLICAR ===\n' : '=== MODO PREVIEW (não escreve) ===\n');

// ───────── 1) ITEM: limpa descricao_original, preserva peso em linha_peso ─────────
const [itens] = await db.query('SELECT id, descricao_original AS d, linha_peso AS lp FROM item');
let nItem = 0, nPeso = 0;
const exItem = [];
for (const it of itens) {
  const limpa = limparDescricao(it.d || '');
  if (!limpa || limpa === it.d) continue;
  nItem++;
  let novaLp = it.lp;
  if ((!it.lp || it.lp === '') && RE_TEM_PESO.test(it.d)) { novaLp = it.d; nPeso++; }
  if (exItem.length < 12) exItem.push(`  "${it.d}"  →  "${limpa}"${novaLp !== it.lp ? `   [peso→linha_peso]` : ''}`);
  if (APPLY) await db.query('UPDATE item SET descricao_original = ?, linha_peso = ? WHERE id = ?', [limpa, novaLp, it.id]);
}
log(`ITEM: ${nItem} descrições limpas (${nPeso} com peso preservado em linha_peso)`);
for (const e of exItem) log(e);

// ───────── 2) SKU_ALIAS: limpa + funde colisões (descricao_original é UNIQUE) ─────────
const [aliases] = await db.query('SELECT id, descricao_original AS d, sku_id, origem, confianca FROM sku_alias');
const grupos = new Map(); // chaveLimpa -> [alias...]
for (const a of aliases) {
  const k = limparDescricao(a.d || '') || a.d;
  (grupos.get(k) || grupos.set(k, []).get(k)).push(a);
}
const peso = { manual: 3, revisao: 2, llm: 1 };
let nAliasMud = 0, nFundidos = 0, nConflitoSku = 0;
const exAlias = [];
for (const [k, grp] of grupos) {
  const mudou = grp.length > 1 || grp[0].d !== k;
  if (!mudou) continue;
  // vencedor: origem mais forte → maior confiança → menor id
  const vencedor = [...grp].sort(
    (a, b) => (peso[b.origem] || 0) - (peso[a.origem] || 0) || (b.confianca || 0) - (a.confianca || 0) || a.id - b.id,
  )[0];
  const skusDistintos = new Set(grp.map((a) => a.sku_id));
  if (skusDistintos.size > 1) nConflitoSku++;
  if (grp.length > 1) nFundidos += grp.length - 1;
  nAliasMud++;
  if (exAlias.length < 12) {
    const orig = grp.map((a) => `"${a.d}"`).join(' + ');
    exAlias.push(`  ${orig}  →  "${k}" (sku ${vencedor.sku_id}${skusDistintos.size > 1 ? `, ⚠ ${skusDistintos.size} skus` : ''})`);
  }
  if (APPLY) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const ids = grp.map((a) => a.id);
      await conn.query(`DELETE FROM sku_alias WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      await conn.query('INSERT INTO sku_alias (descricao_original, sku_id, origem, confianca) VALUES (?,?,?,?)', [
        k, vencedor.sku_id, vencedor.origem, vencedor.confianca,
      ]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      log('  ERRO alias', k, e.message);
    } finally {
      conn.release();
    }
  }
}
log(`\nSKU_ALIAS: ${nAliasMud} chaves limpas · ${nFundidos} aliases fundidos · ${nConflitoSku} grupos com skus diferentes (resolvidos pelo vencedor)`);
for (const e of exAlias) log(e);

// ───────── 3) Dissociar o mamão da Banana ─────────
const [[banana]] = await db.query("SELECT id FROM sku_normalizado WHERE nome_canonico = 'Banana' LIMIT 1");
if (banana) {
  const [its] = await db.query(
    "SELECT id, descricao_original FROM item WHERE sku_id = ? AND descricao_original LIKE '%MANAO%'",
    [banana.id],
  );
  log(`\nMAMÃO: ${its.length} item(ns) "MANAO" ligado(s) à Banana #${banana.id}:`, its.map((x) => `#${x.id} "${x.descricao_original}"`).join(', ') || '(nenhum)');
  if (APPLY && its.length) {
    await db.query("UPDATE item SET sku_id = NULL WHERE sku_id = ? AND descricao_original LIKE '%MANAO%'", [banana.id]);
    await db.query("DELETE FROM sku_alias WHERE sku_id = ? AND descricao_original LIKE '%MANAO%'", [banana.id]);
    log('  → dissociado (sku_id=NULL, alias removido). Vai para a worklist de Revisão.');
  }
}

log('\n' + (APPLY ? '✓ aplicado.' : '(preview — corre com --apply para escrever.)'));
await db.end();
process.exit(0);

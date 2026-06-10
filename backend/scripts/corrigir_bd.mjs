// Corrige as inconsistências encontradas pelo diagnostico_bd.mjs. Idempotente.
// Por omissão é DRY-RUN (mostra o que faria, não altera nada).
//   node scripts/corrigir_bd.mjs            ← dry-run
//   node scripts/corrigir_bd.mjs --aplicar  ← executa (numa transação)
//
// O que corrige (causas: reprocess apagava itens sem soltar referências; merge de
// SKUs antigo não preservava tabelas satélite; NIF lido com/sem prefixo "PT"
// duplicava lojas; EANs mal lidos por VLM entravam sem validação):
//  1. produto_nome.sku_id órfão → NULL (o EAN continua a ser a chave forte)
//  2. produto_generico órfão → remapeia p/ SKU atual com o mesmo nome_canonico
//     (se único e livre); senão apaga (cache regenerável)
//  3. produto_ean.item_id / produto_ean.sku_id órfãos → NULL
//  4. produto_analise de SKU inexistente → apaga (cache regenerável)
//  5. produto_foto de item inexistente → item_id NULL se tem EAN (continua
//     alcançável pela ficha); senão apaga a LINHA (o ficheiro fica no disco)
//  6. EANs inválidos (dígito verificador): item.ean → NULL (volta à worklist);
//     produto_ean.ean → NULL se a ficha tem item (mantém os dados); senão apaga
//  7. "Claim EAN": ficha sem EAN ligada a item COM EAN válido e livre → adota-o
//  8. peso_em_falta=1 mas ppb preenchido → peso_em_falta=0 (contradição)
//  9. Lojas duplicadas (mesma cadeia+nome, NIF só difere no formato/má leitura):
//     funde na de id mais baixo, repontando as faturas
// 10. Normaliza NIFs (só dígitos — tira o prefixo "PT")
import { getPool } from '../src/db.js';
import { eanValido } from '../src/ingest/produto.js';

const APLICAR = process.argv.includes('--aplicar');
const acoes = [];
function planeia(desc, sql, params = []) { acoes.push({ desc, sql, params }); }

async function main() {
  const pool = getPool();
  const q = async (sql, params = []) => (await pool.query(sql, params))[0];

  // 1. produto_nome órfão de SKU
  const pnOrfaos = await q(
    'SELECT pn.id, pn.nome, pn.sku_id FROM produto_nome pn LEFT JOIN sku_normalizado s ON s.id = pn.sku_id WHERE pn.sku_id IS NOT NULL AND s.id IS NULL');
  for (const r of pnOrfaos) planeia(`produto_nome #${r.id} "${r.nome}": sku ${r.sku_id} não existe → sku_id NULL`,
    'UPDATE produto_nome SET sku_id = NULL WHERE id = ?', [r.id]);

  // 2. produto_generico órfão: remapeia por nome igual, senão apaga
  const pgOrfaos = await q(`
    SELECT pg.sku_id, pg.alimento,
      (SELECT GROUP_CONCAT(s2.id) FROM sku_normalizado s2 WHERE LOWER(s2.nome_canonico) = LOWER(pg.alimento)) AS candidatos
    FROM produto_generico pg LEFT JOIN sku_normalizado s ON s.id = pg.sku_id WHERE s.id IS NULL`);
  for (const r of pgOrfaos) {
    const cands = (r.candidatos || '').split(',').filter(Boolean);
    let alvoLivre = null;
    if (cands.length === 1) {
      const [[ocupado]] = await pool.query('SELECT sku_id FROM produto_generico WHERE sku_id = ?', [cands[0]]);
      if (!ocupado) alvoLivre = Number(cands[0]);
    }
    if (alvoLivre) planeia(`produto_generico "${r.alimento}" (sku morto ${r.sku_id}) → remapeia p/ sku ${alvoLivre}`,
      'UPDATE produto_generico SET sku_id = ? WHERE sku_id = ?', [alvoLivre, r.sku_id]);
    else planeia(`produto_generico "${r.alimento}" (sku morto ${r.sku_id}) → apaga (sem alvo único livre)`,
      'DELETE FROM produto_generico WHERE sku_id = ?', [r.sku_id]);
  }

  // 3. produto_ean com referências órfãs
  const peItemOrfao = await q(
    'SELECT pe.id, pe.ean, pe.nome, pe.item_id FROM produto_ean pe LEFT JOIN item i ON i.id = pe.item_id WHERE pe.item_id IS NOT NULL AND i.id IS NULL');
  for (const r of peItemOrfao) planeia(`produto_ean #${r.id} "${r.nome || r.ean}": item ${r.item_id} não existe → item_id NULL`,
    'UPDATE produto_ean SET item_id = NULL WHERE id = ?', [r.id]);
  const peSkuOrfao = await q(
    'SELECT pe.id, pe.ean, pe.nome, pe.sku_id FROM produto_ean pe LEFT JOIN sku_normalizado s ON s.id = pe.sku_id WHERE pe.sku_id IS NOT NULL AND s.id IS NULL');
  for (const r of peSkuOrfao) planeia(`produto_ean #${r.id} "${r.nome || r.ean}": sku ${r.sku_id} não existe → sku_id NULL`,
    'UPDATE produto_ean SET sku_id = NULL WHERE id = ?', [r.id]);

  // 4. produto_analise de SKU inexistente (chave "sku:<id>")
  const paOrfas = await q(`
    SELECT pa.id, pa.chave FROM produto_analise pa
    LEFT JOIN sku_normalizado s ON pa.chave = CONCAT('sku:', s.id)
    WHERE pa.chave LIKE 'sku:%' AND s.id IS NULL`);
  for (const r of paOrfas) planeia(`produto_analise #${r.id} (${r.chave}): sku não existe → apaga (cache)`,
    'DELETE FROM produto_analise WHERE id = ?', [r.id]);

  // 5. produto_foto de item inexistente
  const pfOrfas = await q(
    'SELECT pf.id, pf.item_id, pf.ean, pf.ficheiro FROM produto_foto pf LEFT JOIN item i ON i.id = pf.item_id WHERE pf.item_id IS NOT NULL AND i.id IS NULL');
  for (const r of pfOrfas) {
    if (r.ean) planeia(`produto_foto #${r.id} (${r.ficheiro}): item ${r.item_id} não existe, tem EAN ${r.ean} → item_id NULL`,
      'UPDATE produto_foto SET item_id = NULL WHERE id = ?', [r.id]);
    else planeia(`produto_foto #${r.id} (${r.ficheiro}): item ${r.item_id} não existe, sem EAN → apaga linha (ficheiro fica)`,
      'DELETE FROM produto_foto WHERE id = ?', [r.id]);
  }

  // 6. EANs inválidos (dígito verificador)
  const itensEanMau = await q('SELECT id, descricao_original, ean FROM item WHERE ean IS NOT NULL');
  for (const r of itensEanMau.filter((i) => !eanValido(i.ean)))
    planeia(`item #${r.id} "${r.descricao_original}": EAN ${r.ean} inválido → NULL (volta à worklist p/ re-scan)`,
      'UPDATE item SET ean = NULL WHERE id = ?', [r.id]);
  const fichasEanMau = (await q('SELECT id, ean, nome, item_id FROM produto_ean WHERE ean IS NOT NULL')).filter((p) => !eanValido(p.ean));
  for (const r of fichasEanMau) {
    if (r.item_id) planeia(`produto_ean #${r.id} "${r.nome}": EAN ${r.ean} inválido, tem item → ean NULL (ficha fica pelo item)`,
      'UPDATE produto_ean SET ean = NULL WHERE id = ?', [r.id]);
    else planeia(`produto_ean #${r.id} "${r.nome}": EAN ${r.ean} inválido, sem item → apaga (inalcançável)`,
      'DELETE FROM produto_ean WHERE id = ?', [r.id]);
  }

  // 7. Claim EAN: ficha sem EAN cujo item tem EAN válido e sem ficha própria
  const claims = await q(`
    SELECT pe.id, pe.nome, i.ean, i.descricao_original FROM produto_ean pe
    JOIN item i ON i.id = pe.item_id
    WHERE pe.ean IS NULL AND i.ean IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM produto_ean pe2 WHERE pe2.ean = i.ean)`);
  for (const r of claims.filter((c) => eanValido(c.ean)))
    planeia(`produto_ean #${r.id} "${r.nome || r.descricao_original}": adota EAN ${r.ean} do item (livre)`,
      'UPDATE produto_ean SET ean = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM produto_ean WHERE ean = ?) t)', [r.ean, r.id, r.ean]);

  // 8. peso_em_falta contraditório
  const contraditorios = await q('SELECT id, descricao_original FROM item WHERE peso_em_falta = 1 AND preco_por_base IS NOT NULL');
  for (const r of contraditorios) planeia(`item #${r.id} "${r.descricao_original}": peso_em_falta=1 mas ppb existe → peso_em_falta=0`,
    'UPDATE item SET peso_em_falta = 0 WHERE id = ?', [r.id]);

  // 9. Lojas duplicadas: mesma cadeia + mesmo nome (case-insensitive) → funde na de id mais baixo
  const dups = await q(`
    SELECT MIN(id) AS manter, GROUP_CONCAT(id ORDER BY id) AS ids, cadeia, LOWER(nome) AS nome
    FROM loja GROUP BY cadeia, LOWER(nome) HAVING COUNT(*) > 1`);
  for (const g of dups) {
    const apagar = g.ids.split(',').map(Number).filter((id) => id !== g.manter);
    planeia(`lojas duplicadas "${g.cadeia} / ${g.nome}" (ids ${g.ids}): faturas → #${g.manter}`,
      'UPDATE fatura SET loja_id = ? WHERE loja_id IN (?)', [g.manter, apagar]);
    planeia(`  └ apaga lojas ${apagar.join(', ')}`,
      'DELETE FROM loja WHERE id IN (?)', [apagar]);
  }

  // 10. NIFs com prefixo PT → só dígitos
  const nifsPT = await q("SELECT id, nome, nif FROM loja WHERE nif REGEXP '[^0-9]'");
  for (const r of nifsPT) planeia(`loja #${r.id} "${r.nome}": nif "${r.nif}" → "${String(r.nif).replace(/\D/g, '')}"`,
    'UPDATE loja SET nif = ? WHERE id = ?', [String(r.nif).replace(/\D/g, ''), r.id]);

  // ── Execução ────────────────────────────────────────────────────────────
  if (!acoes.length) { console.log('Nada a corrigir — base consistente. ✓'); await pool.end(); return; }
  console.log(`${APLICAR ? 'A APLICAR' : 'DRY-RUN'} — ${acoes.length} correções:\n`);
  for (const a of acoes) console.log('  •', a.desc);
  if (APLICAR) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const a of acoes) await conn.query(a.sql, a.params);
      await conn.commit();
      console.log(`\nAplicadas ${acoes.length} correções. ✓`);
    } catch (e) {
      await conn.rollback();
      console.error('\nERRO — rollback feito:', e.message);
      process.exitCode = 1;
    } finally {
      conn.release();
    }
  } else {
    console.log('\n(dry-run — nada foi alterado; corre com --aplicar para executar)');
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

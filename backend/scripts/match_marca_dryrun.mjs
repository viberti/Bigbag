// Dry-run do matching com PORTA DE MARCA + peso de preço (Caso 2). Corre sobre os
// produtos REAIS sem EAN e mostra: quantos ganham proposta (marca bate) vs filtrados,
// e valida contra os itens que JÁ têm EAN (o topo bate o EAN conhecido?). NÃO grava.
//   node scripts/match_marca_dryrun.mjs
import { getPool } from '../src/db.js';
import { candidatosCatalogo } from '../src/normaliza/resolverProduto.js';

const eur = (v) => (v == null ? '—' : Number(v).toFixed(2));

async function main() {
  const pool = getPool();
  // distintos SEM ean (cobertura) — com marca extraída e €/base médio.
  const [semEan] = await pool.query(
    `SELECT i.descricao_original d, MAX(s.nome_canonico) canon,
            MAX((SELECT pe.marca FROM produto_ean pe WHERE pe.item_id=i.id AND pe.marca IS NOT NULL LIMIT 1)) marca,
            AVG(i.preco_por_base) ppb, COUNT(*) compras
       FROM item i LEFT JOIN sku_normalizado s ON s.id=i.sku_id
      WHERE i.is_non_product=0 AND i.ean IS NULL
        AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL)
      GROUP BY i.descricao_original`);
  // distintos COM ean conhecido (validação de precisão).
  const [comEan] = await pool.query(
    `SELECT i.descricao_original d, MAX(s.nome_canonico) canon, MAX(pe.marca) marca,
            MAX(pe.ean) ean, AVG(i.preco_por_base) ppb
       FROM item i JOIN produto_ean pe ON pe.item_id=i.id
       LEFT JOIN sku_normalizado s ON s.id=i.sku_id
      WHERE i.is_non_product=0 AND pe.ean IS NOT NULL
      GROUP BY i.descricao_original`);

  let propostas = 0, filtrados = 0;
  const exProp = [], exFiltr = [];
  for (const it of semEan) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, marca: it.marca, preco_por_base: it.ppb });
    const top = cand[0];
    if (top && top.score >= 0.5) {
      propostas++;
      if (exProp.length < 14) exProp.push(
        `  ${Math.round(top.score*100)}% "${it.d}" (€/b ${eur(it.ppb)})\n        → ${top.marca||'?'} | ${String(top.nome).slice(0,46)} [${top.ean}] €/b ${eur(top.preco_por_base)} [${top.fonte}]`);
    } else {
      filtrados++;
      if (exFiltr.length < 16) exFiltr.push(`"${it.d}"`);
    }
  }

  let acertos = 0, validados = 0, divergentes = [];
  for (const it of comEan) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, marca: it.marca, preco_por_base: it.ppb });
    const top = cand[0];
    if (!top || top.score < 0.5) continue;
    validados++;
    if (String(top.ean) === String(it.ean)) acertos++;
    else if (divergentes.length < 8) divergentes.push(`  "${it.d}" → propôs ${top.ean} (${top.marca}), conhecido ${it.ean}`);
  }

  console.log(`=== CASO 2 (marca nacional) — dry-run com porta de marca + preço ===\n`);
  console.log(`Produtos SEM EAN: ${semEan.length}`);
  console.log(`  → com proposta (marca bate, score≥0.5): ${propostas} (${Math.round(100*propostas/semEan.length)}%)`);
  console.log(`  → filtrados (sem marca a bater): ${filtrados} (${Math.round(100*filtrados/semEan.length)}%)`);
  console.log(`\nValidação (itens com EAN conhecido): ${acertos}/${validados} o topo bate o EAN real`);
  if (divergentes.length) console.log(`  divergências:\n${divergentes.join('\n')}`);
  console.log(`\n── Exemplos de PROPOSTAS ──\n${exProp.join('\n')}`);
  console.log(`\n── Filtrados (sem proposta — vão para Caso 1/classe) ──\n  ${exFiltr.join(' · ')}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

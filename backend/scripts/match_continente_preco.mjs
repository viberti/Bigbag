// Mesma loja (Continente → catálogo Continente): testa o PAPEL DO PREÇO. Para os
// itens com EAN conhecido, vê (1) se o EAN certo está entre os candidatos e (2) qual
// RANKING o coloca em 1.º — por comida (score), por proximidade de preço (€/base), ou
// combinado. Se o preço-proximidade ganhar, confirma a tese. NÃO grava.
//   node --env-file=.env scripts/match_continente_preco.mjs
import { getPool } from '../src/db.js';
import { candidatosCatalogo } from '../src/normaliza/resolverProduto.js';

const OPTS = { fonte: 'continente', portaMarca: false, limite: 30 };
const prox = (a, b) => (a && b ? Math.abs(Math.log(a / b)) : 99); // 0 = igual

async function main() {
  const pool = getPool();
  const [comEan] = await pool.query(`
    SELECT i.descricao_original d, MAX(s.nome_canonico) canon, MAX(pe.ean) ean, AVG(i.preco_por_base) ppb
      FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
      JOIN produto_ean pe ON pe.item_id=i.id LEFT JOIN sku_normalizado s ON s.id=i.sku_id
     WHERE COALESCE(l.cadeia,l.nome)='Continente' AND i.is_non_product=0 AND pe.ean IS NOT NULL
     GROUP BY i.descricao_original`);

  let total = 0, inCand = 0, topScore = 0, topPreco = 0, topComb = 0, semPpb = 0;
  const exemplos = [];
  for (const it of comEan) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, preco_por_base: it.ppb }, OPTS);
    const bons = cand.filter((c) => c.score >= 0.4);
    if (!bons.length) continue;
    total++;
    const conhecido = String(it.ean);
    if (bons.some((c) => String(c.ean) === conhecido)) inCand++;
    if (!it.ppb || !bons.some((c) => c.preco_por_base)) semPpb++;

    const byScore = [...bons].sort((a, b) => b.score - a.score);
    const byPreco = [...bons].sort((a, b) => prox(it.ppb, a.preco_por_base) - prox(it.ppb, b.preco_por_base));
    const comb = (c) => { const p = prox(it.ppb, c.preco_por_base); return c.score + (p < 0.15 ? 0.4 : p < 0.3 ? 0.2 : p > 0.7 ? -0.3 : 0); };
    const byComb = [...bons].sort((a, b) => comb(b) - comb(a));

    if (String(byScore[0].ean) === conhecido) topScore++;
    if (String(byPreco[0].ean) === conhecido) topPreco++;
    if (String(byComb[0].ean) === conhecido) topComb++;

    if (exemplos.length < 12 && bons.some((c) => String(c.ean) === conhecido)) {
      const real = bons.find((c) => String(c.ean) === conhecido);
      exemplos.push(`"${it.d}" (€/b ${it.ppb?.toFixed?.(2) ?? '—'})\n   score#1: ${byScore[0].nome.slice(0,34)} €/b ${byScore[0].preco_por_base?.toFixed?.(2)??'—'} ${String(byScore[0].ean)===conhecido?'✓':'✗'}\n   preço#1: ${byPreco[0].nome.slice(0,34)} €/b ${byPreco[0].preco_por_base?.toFixed?.(2)??'—'} ${String(byPreco[0].ean)===conhecido?'✓':'✗'}\n   (real:  ${real.nome.slice(0,34)} €/b ${real.preco_por_base?.toFixed?.(2)??'—'})`);
    }
  }
  console.log('=== Papel do PREÇO no match mesma-loja (Continente) ===\n');
  console.log(`Itens com candidatos: ${total}  (sem €/base comparável: ${semPpb})`);
  console.log(`EAN certo ENTRE os candidatos: ${inCand}/${total} (${Math.round(100 * inCand / total)}%) ← teto possível`);
  console.log(`Topo certo por:`);
  console.log(`  SCORE (comida):  ${topScore}/${total} (${Math.round(100 * topScore / total)}%)`);
  console.log(`  PREÇO (€/base):  ${topPreco}/${total} (${Math.round(100 * topPreco / total)}%)`);
  console.log(`  SCORE+PREÇO:     ${topComb}/${total} (${Math.round(100 * topComb / total)}%)`);
  console.log(`\n── exemplos (score#1 vs preço#1 vs real) ──\n${exemplos.join('\n')}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

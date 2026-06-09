// Mesma loja (Continente): testa o preço de EMBALAGEM (preco_liquido pago vs preco
// do catálogo) — independente da unidade, o sinal mais puro da mesma loja. Compara
// rankings: comida, preço-embalagem, e combinado. NÃO grava.
//   node --env-file=.env scripts/match_continente_preco2.mjs
import { getPool } from '../src/db.js';
import { candidatosCatalogo } from '../src/normaliza/resolverProduto.js';

const OPTS = { fonte: 'continente', portaMarca: false, limite: 30 };
const prox = (a, b) => (a && b ? Math.abs(Math.log(a / b)) : 99);

async function main() {
  const pool = getPool();
  const [comEan] = await pool.query(`
    SELECT i.descricao_original d, MAX(s.nome_canonico) canon, MAX(pe.ean) ean,
           AVG(i.preco_por_base) ppb, AVG(i.preco_liquido) preco
      FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
      JOIN produto_ean pe ON pe.item_id=i.id LEFT JOIN sku_normalizado s ON s.id=i.sku_id
     WHERE COALESCE(l.cadeia,l.nome)='Continente' AND i.is_non_product=0 AND pe.ean IS NOT NULL
     GROUP BY i.descricao_original`);

  let total = 0, inCand = 0, topScore = 0, topEmb = 0, topComb = 0;
  const ex = [];
  for (const it of comEan) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, preco_por_base: it.ppb }, OPTS);
    const bons = cand.filter((c) => c.score >= 0.4);
    if (!bons.length) continue;
    total++;
    const conhecido = String(it.ean);
    if (bons.some((c) => String(c.ean) === conhecido)) inCand++;

    const byScore = [...bons].sort((a, b) => b.score - a.score);
    const byEmb = [...bons].sort((a, b) => prox(it.preco, a.preco) - prox(it.preco, b.preco));
    const comb = (c) => { const p = prox(it.preco, c.preco); return c.score + (p < 0.1 ? 0.5 : p < 0.2 ? 0.3 : p > 0.6 ? -0.4 : 0); };
    const byComb = [...bons].sort((a, b) => comb(b) - comb(a));

    if (String(byScore[0].ean) === conhecido) topScore++;
    if (String(byEmb[0].ean) === conhecido) topEmb++;
    if (String(byComb[0].ean) === conhecido) topComb++;

    if (ex.length < 12 && bons.some((c) => String(c.ean) === conhecido)) {
      const real = bons.find((c) => String(c.ean) === conhecido);
      ex.push(`"${it.d}" (pago €${it.preco?.toFixed?.(2) ?? '—'})\n   comb#1: ${byComb[0].nome.slice(0,32)} €${byComb[0].preco?.toFixed?.(2)??'—'} ${String(byComb[0].ean)===conhecido?'✓':'✗'}  ·  real: ${real.nome.slice(0,28)} €${real.preco?.toFixed?.(2)??'—'}`);
    }
  }
  console.log('=== Preço de EMBALAGEM no match Continente ===\n');
  console.log(`Itens com candidatos: ${total}`);
  console.log(`EAN certo ENTRE candidatos: ${inCand}/${total} (${Math.round(100 * inCand / total)}%) ← teto`);
  console.log(`Topo certo por:`);
  console.log(`  SCORE (comida):    ${topScore}/${total} (${Math.round(100 * topScore / total)}%)`);
  console.log(`  PREÇO embalagem:   ${topEmb}/${total} (${Math.round(100 * topEmb / total)}%)`);
  console.log(`  SCORE+embalagem:   ${topComb}/${total} (${Math.round(100 * topComb / total)}%)`);
  console.log(`\n── exemplos (combinado vs real) ──\n${ex.join('\n')}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

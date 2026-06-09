// Mede a COBERTURA do matching: para cada produto distinto dos talões, vê se há
// candidato no catálogo (Auchan/Continente, com EAN) e a força (pontuação por
// tokens/marca/formato). Sem LLM/OFF → rápido. Dá o número "quantos dão match".
//   node scripts/match_cobertura.mjs
import { getPool } from '../src/db.js';
import { candidatosCatalogo } from '../src/normaliza/resolverProduto.js';

async function main() {
  const pool = getPool();
  // produtos distintos comprados (exclui não-produto). Usa o nome canónico se houver.
  const [itens] = await pool.query(
    `SELECT i.descricao_original d, MAX(s.nome_canonico) canon,
            MAX((SELECT pe.marca FROM produto_ean pe WHERE pe.item_id=i.id AND pe.marca IS NOT NULL LIMIT 1)) marca,
            COUNT(*) compras
       FROM item i LEFT JOIN sku_normalizado s ON s.id=i.sku_id
      WHERE i.is_non_product=0
      GROUP BY i.descricao_original`);

  const bandas = { forte: 0, medio: 0, fraco: 0, nada: 0 };
  const fonteTop = {};
  let comCand = 0;
  const exemplos = { forte: [], nada: [] };

  for (const it of itens) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, marca: it.marca });
    const top = cand[0];
    if (top) comCand++;
    const s = top ? top.score : 0;
    const banda = s >= 0.8 ? 'forte' : s >= 0.6 ? 'medio' : s >= 0.4 ? 'fraco' : 'nada';
    bandas[banda]++;
    if (top && s >= 0.6) fonteTop[top.fonte] = (fonteTop[top.fonte] || 0) + 1;
    if (banda === 'forte' && exemplos.forte.length < 6) exemplos.forte.push(`"${it.d}" → ${top.nome.slice(0,40)} [${top.fonte}] ${s.toFixed(2)}`);
    if (banda === 'nada' && exemplos.nada.length < 6) exemplos.nada.push(`"${it.d}"`);
  }

  const tot = itens.length;
  const pct = (n) => `${n} (${Math.round((100 * n) / tot)}%)`;
  console.log(`Produtos distintos nos talões: ${tot}\n`);
  console.log(`Com candidato no catálogo: ${pct(comCand)}`);
  console.log(`  forte (≥0.80): ${pct(bandas.forte)}`);
  console.log(`  médio (≥0.60): ${pct(bandas.medio)}`);
  console.log(`  fraco (≥0.40): ${pct(bandas.fraco)}`);
  console.log(`  sem match  :   ${pct(bandas.nada)}`);
  console.log(`\nFonte do melhor candidato (médio+forte):`);
  for (const [f, n] of Object.entries(fonteTop).sort((a, b) => b[1] - a[1])) console.log(`  ${f}: ${n}`);
  console.log(`\nExemplos FORTE:\n  ${exemplos.forte.join('\n  ')}`);
  console.log(`\nExemplos SEM match:\n  ${exemplos.nada.join(' · ')}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

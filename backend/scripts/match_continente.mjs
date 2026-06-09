// Testa o match dos itens de talão do CONTINENTE (sem EAN) contra o catálogo do
// PRÓPRIO Continente (mesma loja → as marcas-próprias estão lá, sem risco cross-cadeia).
// Sem porta de marca (a marca é implícita à loja). Reporta cobertura + precisão
// (valida contra os itens Continente que JÁ têm EAN). NÃO grava.
//   node --env-file=.env scripts/match_continente.mjs
import { getPool } from '../src/db.js';
import { candidatosCatalogo } from '../src/normaliza/resolverProduto.js';

const OPTS = { fonte: 'continente', portaMarca: false };

async function main() {
  const pool = getPool();
  const [semEan] = await pool.query(`
    SELECT i.descricao_original d, MAX(s.nome_canonico) canon, AVG(i.preco_por_base) ppb, COUNT(*) compras
      FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
      LEFT JOIN sku_normalizado s ON s.id=i.sku_id
     WHERE COALESCE(l.cadeia,l.nome)='Continente' AND i.is_non_product=0 AND i.ean IS NULL
       AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL)
     GROUP BY i.descricao_original`);
  const [comEan] = await pool.query(`
    SELECT i.descricao_original d, MAX(s.nome_canonico) canon, MAX(pe.ean) ean, AVG(i.preco_por_base) ppb
      FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
      JOIN produto_ean pe ON pe.item_id=i.id LEFT JOIN sku_normalizado s ON s.id=i.sku_id
     WHERE COALESCE(l.cadeia,l.nome)='Continente' AND i.is_non_product=0 AND pe.ean IS NOT NULL
     GROUP BY i.descricao_original`);

  const bandas = { forte: 0, medio: 0, fraco: 0, nada: 0 };
  const exForte = [], exNada = [];
  for (const it of semEan) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, preco_por_base: it.ppb }, OPTS);
    const top = cand[0]; const s = top ? top.score : 0;
    const b = s >= 0.8 ? 'forte' : s >= 0.6 ? 'medio' : s >= 0.4 ? 'fraco' : 'nada';
    bandas[b]++;
    if (b === 'forte' && exForte.length < 14) exForte.push(`  ${Math.round(s * 100)}% "${it.d}" → ${String(top.nome).slice(0, 48)} [${top.ean}]`);
    if (b === 'nada' && exNada.length < 16) exNada.push(`"${it.d}"`);
  }

  let acertos = 0, val = 0; const div = [];
  for (const it of comEan) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, preco_por_base: it.ppb }, OPTS);
    const top = cand[0]; if (!top || top.score < 0.5) continue;
    val++;
    if (String(top.ean) === String(it.ean)) acertos++;
    else if (div.length < 10) div.push(`  "${it.d}" → ${top.ean} (${String(top.nome).slice(0, 34)}), conhecido ${it.ean}`);
  }

  const tot = semEan.length; const pct = (n) => `${n} (${Math.round((100 * n) / tot)}%)`;
  console.log('=== Match Continente → catálogo Continente (sem porta de marca) ===\n');
  console.log(`Produtos Continente SEM EAN: ${tot}`);
  console.log(`  forte ≥0.80: ${pct(bandas.forte)}`);
  console.log(`  médio ≥0.60: ${pct(bandas.medio)}`);
  console.log(`  fraco ≥0.40: ${pct(bandas.fraco)}`);
  console.log(`  sem match  : ${pct(bandas.nada)}`);
  console.log(`\nPrecisão (itens Continente com EAN conhecido): ${acertos}/${val} o topo bate o EAN real`);
  if (div.length) console.log('  divergências:\n' + div.join('\n'));
  console.log(`\n── FORTE ──\n${exForte.join('\n')}`);
  console.log(`\n── sem match ──\n  ${exNada.join(' · ')}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

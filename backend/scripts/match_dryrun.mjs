// Dry-run do resolvedor de produto: corre sobre itens REAIS de talão e reporta o
// EAN proposto + fonte + confiança. Para itens que JÁ têm EAN, valida a precisão
// (o resolvedor devolve o MESMO EAN?). NÃO grava nada.
//   node scripts/match_dryrun.mjs [n]
import { getPool } from '../src/db.js';
import { resolverProduto } from '../src/normaliza/resolverProduto.js';

const N = Number(process.argv[2] || 12);

async function main() {
  const pool = getPool();
  // metade COM EAN conhecido (validação), metade SEM (cobertura)
  const [comEan] = await pool.query(
    `SELECT i.descricao_original d, pe.ean ean, pe.marca marca
       FROM item i JOIN produto_ean pe ON pe.item_id = i.id
      WHERE i.is_non_product=0 AND pe.ean IS NOT NULL
      GROUP BY i.descricao_original ORDER BY RAND() LIMIT ?`, [Math.ceil(N / 2)]);
  const [semEan] = await pool.query(
    `SELECT i.descricao_original d, NULL ean, NULL marca
       FROM item i
      WHERE i.is_non_product=0 AND i.ean IS NULL
        AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL)
      GROUP BY i.descricao_original ORDER BY RAND() LIMIT ?`, [Math.floor(N / 2)]);

  const itens = [...comEan, ...semEan];
  let acertos = 0, comEanTotal = 0, resolvidos = 0;
  for (const it of itens) {
    const r = await resolverProduto(pool, { descricao: it.d, marca: it.marca }, { usarLLM: true });
    const conhecido = it.ean ? String(it.ean) : null;
    if (conhecido) comEanTotal++;
    let veredicto = '';
    if (r) {
      resolvidos++;
      if (conhecido) {
        const bate = String(r.ean) === conhecido;
        if (bate) acertos++;
        veredicto = bate ? '✓ BATE' : `✗ DIVERGE (conhecido ${conhecido})`;
      } else veredicto = '(novo)';
    } else veredicto = conhecido ? '— não resolveu (tinha EAN)' : '— sem match';
    console.log(`"${it.d}"${it.marca ? ` [${it.marca}]` : ''}`);
    console.log(r
      ? `   → EAN ${r.ean} · ${String(r.nome).slice(0, 44)} · ${r.origem} · conf ${(r.confianca).toFixed(2)} · ${r.via} ${veredicto}`
      : `   → ${veredicto}`);
  }
  console.log(`\n=== ${itens.length} itens | resolvidos ${resolvidos} | precisão (com EAN conhecido): ${acertos}/${comEanTotal} ===`);
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

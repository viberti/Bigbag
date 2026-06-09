// Testa o pipeline de BUSCA WEB (CSE) → sku_fonte → catálogo → EAN.
// Pega itens de talão Continente AINDA SEM EAN, busca cada nome na web e mostra
// o EAN encontrado + cruzamento de nome. Limita a N itens (free tier 100/dia).
//   node scripts/teste_busca_web.mjs [N]
import { getPool } from '../src/db.js';
import { buscaWebDisponivel, buscarProdutoWeb } from '../src/normaliza/buscaWeb.js';

async function main() {
  if (!buscaWebDisponivel()) {
    console.log('✗ GOOGLE_CSE_KEY/GOOGLE_CSE_CX não definidos no .env');
    process.exit(1);
  }
  const N = Number(process.argv[2] || 8);
  const pool = getPool();

  // itens Continente sem EAN (por descrição), não-frescos, não-identificados
  const [itens] = await pool.query(
    `SELECT i.descricao_original d, MAX(s.nome_canonico) canon, COUNT(*) compras
       FROM item i
       JOIN fatura f ON f.id=i.fatura_id
       LEFT JOIN sku_normalizado s ON s.id=i.sku_id
      WHERE i.is_non_product=0 AND i.ean IS NULL
        AND f.cadeia LIKE '%continente%'
        AND NOT EXISTS (SELECT 1 FROM produto_ean pe
                          JOIN item i2 ON i2.id=pe.item_id
                         WHERE i2.descricao_original=i.descricao_original AND pe.ean IS NOT NULL)
      GROUP BY i.descricao_original
      ORDER BY compras DESC
      LIMIT ?`, [N]);

  console.log(`Testando ${itens.length} itens Continente sem EAN:\n`);
  let achou = 0, conflito = 0;
  for (const it of itens) {
    const r = await buscarProdutoWeb(pool, { descricao: it.canon || it.d, descricaoRaw: it.d });
    if (r.erro) { console.log(`✗ "${it.d}" → ERRO ${r.codigo}: ${r.erro}`); continue; }
    const top = r.candidatos[0];
    if (!top) { console.log(`·  "${it.d}" → (sem candidato com EAN no catálogo)`); continue; }
    achou++;
    if (top.sabor_conflito) conflito++;
    const flag = top.sabor_conflito ? ' ⚠SABOR' : '';
    console.log(`✓ "${it.d}"`);
    console.log(`    → ${top.nome} [${top.marca || 's/marca'}]  EAN ${top.ean}  ovl=${top.overlap} conf=${top.confianca.toFixed(2)}${flag}`);
  }
  console.log(`\n${achou}/${itens.length} com candidato (${conflito} com conflito de sabor).`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

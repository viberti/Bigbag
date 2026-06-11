// AVALIAÇÃO com VERDADE-NO-TERRENO: itens de talão Mercadona que o dono já
// identificou ao SCANEAR o código de barras do produto → pares nome↔EAN reais.
// Mede se buscarCatalogo (restrito ao catálogo Mercadona) acerta nesse EAN.
//   node scripts/exp_mercadona_groundtruth.mjs
import { getPool } from '../src/db.js';
import { buscarCatalogo } from '../src/normaliza/resolverProduto.js';

const pool = getPool();
const [pares] = await pool.query(`
  SELECT DISTINCT i.descricao_original AS d, i.ean AS ean_real
    FROM item i JOIN fatura f ON f.id = i.fatura_id JOIN loja l ON l.id = f.loja_id
   WHERE COALESCE(l.cadeia, l.nome) = 'Mercadona' AND i.ean IS NOT NULL AND i.is_non_product = 0`);

let noCat = 0, acerto = 0, semMatch = 0, errado = 0, foraCat = 0;
const erros = [];
for (const p of pares) {
  const [[noCatalogo]] = await pool.query(
    "SELECT nome, nome_pt, formato FROM catalogo_produto WHERE fonte IN ('mercadona','mercadona-off') AND ean = ? COLLATE utf8mb4_0900_ai_ci LIMIT 1",
    [p.ean_real]);
  if (!noCatalogo) { foraCat++; continue; } // o EAN real nem está no universo Mercadona → não avaliável
  noCat++;
  const m = await buscarCatalogo(pool, p.d, { cadeia: 'Mercadona', fonteUnica: ['mercadona', 'mercadona-off'], limiar: 0.45 });
  if (!m) { semMatch++; erros.push(`SEM MATCH  ${p.d}  (real: ${noCatalogo.nome_pt || noCatalogo.nome})`); continue; }
  if (String(m.ean) === String(p.ean_real)) acerto++;
  else {
    // o EAN certo estava entre as alternativas?
    const naAlt = (m.alternativas || []).some((a) => String(a.ean) === String(p.ean_real));
    errado++;
    erros.push(`${naAlt ? 'NAS ALTS' : 'ERRADO  '}  ${p.d}  → deu "${m.nome}" (${m.ean}); real "${noCatalogo.nome_pt || noCatalogo.nome}"`);
  }
}
console.log(`Pares nome↔EAN escaneados: ${pares.length}`);
console.log(`  · EAN real FORA do catálogo Mercadona (não avaliável): ${foraCat}`);
console.log(`  · avaliáveis (EAN real no catálogo): ${noCat}`);
console.log(`      ✓ acerto no topo:   ${acerto}/${noCat}`);
console.log(`      ✗ errado/nas alts:  ${errado}`);
console.log(`      – sem match:        ${semMatch}`);
console.log('\nDetalhe:');
for (const e of erros) console.log('  ' + e);
process.exit(0);

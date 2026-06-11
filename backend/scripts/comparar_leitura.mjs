// Compara o MÉTODO NOVO de leitura (2.ª opinião dirigida) com o anterior, sobre
// TODOS os talões de imagem já guardados — SEM tocar em preços, EANs scaneados ou
// quantidades. Para cada talão: deteta nomes suspeitos (nunca vistos + sem hit no
// catálogo) e pede uma 2.ª opinião a um VLM de outra família; regista o que o
// método ANTIGO leu vs o que a 2.ª opinião + catálogo dizem.
//   node scripts/comparar_leitura.mjs            ← dry-run (não altera os itens)
//   node scripts/comparar_leitura.mjs --aplicar  ← aplica as correções confirmadas
import { getPool } from '../src/db.js';
import { verificarNomesFatura } from '../src/ingest/verificarNomes.js';

const APLICAR = process.argv.includes('--aplicar');
const pool = getPool();

const [faturas] = await pool.query(`
  SELECT f.id, l.cadeia, DATE(f.data_compra) dia
    FROM fatura f JOIN loja l ON l.id = f.loja_id
   WHERE f.metodo_extracao = 'vlm' AND f.ficheiro_original IS NOT NULL AND f.ficheiro_original NOT LIKE '%.pdf'
   ORDER BY f.id`);

let totSusp = 0, totCorr = 0, totDuv = 0, comSusp = 0;
const correcoes = [];
console.log(`${APLICAR ? 'A APLICAR' : 'DRY-RUN'} — 2.ª opinião sobre ${faturas.length} talões de imagem\n`);
for (const f of faturas) {
  let r;
  try { r = await verificarNomesFatura(pool, f.id, { aplicar: APLICAR }); }
  catch (e) { console.error(`  fatura ${f.id}: erro ${e.message}`); continue; }
  if (!r.suspeitos) continue;
  comSusp++;
  totSusp += r.suspeitos; totCorr += r.corrigidos.length; totDuv += r.duvidas;
  for (const c of r.corrigidos) correcoes.push({ fatura: f.id, cadeia: f.cadeia, dia: f.dia, ...c });
  console.log(`  fatura ${f.id} (${f.cadeia} ${f.dia.toISOString().slice(0, 10)}): ${r.suspeitos} suspeito(s) · ${r.corrigidos.length} corrigido(s) · ${r.duvidas} dúvida(s)`);
}

console.log(`\n=== RESUMO (novo método vs anterior) ===`);
console.log(`Talões de imagem: ${faturas.length} · com suspeitos: ${comSusp}`);
console.log(`Nomes suspeitos analisados: ${totSusp}`);
console.log(`  ✔ a 2.ª opinião + catálogo CORRIGE: ${totCorr}`);
console.log(`  ? ficam em dúvida (fica o lido):    ${totDuv}`);
console.log(`  = confirmados (leitura estava certa): ${totSusp - totCorr - totDuv}`);
if (correcoes.length) {
  console.log(`\nCORREÇÕES (o que o método anterior leu MAL):`);
  for (const c of correcoes) console.log(`  fatura ${c.fatura} (${c.cadeia}): "${c.de}" → "${c.para}"`);
}
if (!APLICAR) console.log('\n(dry-run — corre com --aplicar para gravar as correções)');
process.exit(0);

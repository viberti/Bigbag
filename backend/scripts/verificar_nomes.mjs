// Verificação de nomes FORA da ingestão — para validar o detetor e tratar
// faturas antigas. Sem argumento: DRY-RUN do detetor (camada 1, sem VLM) sobre
// as últimas N faturas de imagem. Com fatura_id: corre a verificação completa
// (2.ª opinião VLM + voto); --aplicar grava as correções.
//   node scripts/verificar_nomes.mjs                 ← detetor em todas (read-only)
//   node scripts/verificar_nomes.mjs 245             ← completa, dry-run
//   node scripts/verificar_nomes.mjs 245 --aplicar   ← completa, corrige
import { getPool } from '../src/db.js';
import { detetarSuspeitos, verificarNomesFatura } from '../src/ingest/verificarNomes.js';

const pool = getPool();
const args = process.argv.slice(2).filter((a) => a !== '--aplicar');
const APLICAR = process.argv.includes('--aplicar');

if (args[0]) {
  const r = await verificarNomesFatura(pool, Number(args[0]), { aplicar: APLICAR });
  console.log(`Fatura ${args[0]}: ${r.suspeitos} suspeitos · ${r.corrigidos.length} corrigidos${APLICAR ? '' : ' (dry-run: registado mas SEM alterar itens)'} · ${r.duvidas} dúvidas`);
  for (const c of r.corrigidos) console.log(`   ✔ "${c.de}" → "${c.para}"`);
} else {
  const [fats] = await pool.query(`
    SELECT f.id, l.cadeia, DATE(f.data_compra) AS dia FROM fatura f JOIN loja l ON l.id = f.loja_id
     WHERE f.metodo_extracao = 'vlm' AND f.ficheiro_original IS NOT NULL AND f.ficheiro_original NOT LIKE '%.pdf'
     ORDER BY f.id DESC LIMIT 30`);
  for (const f of fats) {
    const s = await detetarSuspeitos(pool, f.id, f.cadeia);
    if (s.length) console.log(`fatura ${f.id} (${f.cadeia} ${f.dia}): ${s.length} suspeito(s) — ${s.map((x) => `"${x.descricao_original}"`).join(', ')}`);
  }
  console.log('\n(read-only — para verificar uma fatura: node scripts/verificar_nomes.mjs <id> [--aplicar])');
}
await pool.end();

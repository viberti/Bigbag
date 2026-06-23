// CLUSTER 1 — limpeza retroativa dos valores-não-preço (sentinela {99999,999999,9999999} +
// centavo <0,50), escopo TODAS as BRL. TUDO numa transação InnoDB com TRIPWIRE:
//   - sem --executar  → só CONTA (dry-run) e mostra o gate de nullability.
//   - com --executar  → abre transação, UPDATE+DELETE, confere afetados vs ~1272/tabela;
//     COMMIT só se dentro da banda; senão ROLLBACK + sai 1 (não improvisa).
// Idempotente: re-correr depois → 0 afetados → COMMIT no-op.
import { getPool, closePool } from '../src/db.js';
const pool = getPool();
const WHERE = "moeda='BRL' AND (preco IN (99999,999999,9999999) OR (preco>0 AND preco<0.50))";
const EXEC = process.argv.includes('--executar');
const BANDA_MAX = 2000, BANDA_MIN = 800; // dry-run: ~1272/tabela; fora disto = tripwire

// (3) GATE de nullability
const [[col]] = await pool.query(
  "SELECT IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='app_bigbag' AND TABLE_NAME='catalogo_produto' AND COLUMN_NAME='preco'");
const aceitaNull = col.IS_NULLABLE === 'YES';
const setExpr = aceitaNull ? 'preco=NULL' : 'preco=0';
console.log(`[gate nullability] catalogo_produto.preco IS_NULLABLE=${col.IS_NULLABLE} (${col.COLUMN_TYPE}) → cleanup usa ${setExpr}`);

// dry-run counts (sempre)
const [[cCp]] = await pool.query(`SELECT COUNT(*) n FROM catalogo_produto WHERE ${WHERE}`);
const [[cHi]] = await pool.query(`SELECT COUNT(*) n FROM catalogo_preco_hist WHERE ${WHERE}`);
console.log(`[contagem ao vivo] catalogo_produto=${cCp.n} · catalogo_preco_hist=${cHi.n}`);

if (!EXEC) { console.log('\n(DRY-RUN — nada alterado. Re-corra com --executar para aplicar.)'); await closePool(); process.exit(0); }

// (4) transação + tripwire
const conn = await pool.getConnection();
let veredicto = 'ROLLBACK';
try {
  await conn.beginTransaction();
  const [u] = await conn.query(`UPDATE catalogo_produto SET ${setExpr} WHERE ${WHERE}`);
  const [d] = await conn.query(`DELETE FROM catalogo_preco_hist WHERE ${WHERE}`);
  const dentro = (n) => n === 0 || (n >= BANDA_MIN && n <= BANDA_MAX);
  console.log(`\n[transação] UPDATE catalogo_produto afetou ${u.affectedRows} · DELETE catalogo_preco_hist afetou ${d.affectedRows}`);
  if (dentro(u.affectedRows) && dentro(d.affectedRows)) { await conn.commit(); veredicto = 'COMMIT'; }
  else { await conn.rollback(); veredicto = `ROLLBACK (TRIPWIRE: fora da banda [${BANDA_MIN},${BANDA_MAX}])`; }
  console.log(`\n>>> ${veredicto} <<<`);
} catch (e) { await conn.rollback(); console.error('ROLLBACK por erro:', e.message); veredicto = 'ROLLBACK(erro)'; }
finally { conn.release(); }
await closePool();
process.exit(veredicto === 'COMMIT' ? 0 : 1);

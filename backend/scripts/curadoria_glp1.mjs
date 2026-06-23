// Cluster 2 — insere/atualiza os valores CURADOS de força clínica + qtd da classe GLP-1
// (Ozempic+Mounjaro+Extensior+Ozivy+Poviztra+Wegovy, 23 EANs). Idempotente (ON DUPLICATE) em
// UMA transação. Força do texto oficial `apresentacao` + cross-check da lupa. registro vem da
// `medicamento` (rastreabilidade). NÃO edita `medicamento`. Read-only fora desta tabela.
import { getPool, closePool } from '../src/db.js';
const pool = getPool();

// [ean, forca, max, papel, qtd_corr, nota]
const CURADO = [
  ['7897705202586', 1, null, 'manutencao', null, 'Ozempic 1mg — apres "DOSES 1 MG"'],
  ['7897705202548', 0.25, 0.5, 'inicio', null, 'Ozempic starter 0,25/0,5 — apres "DOSES 0,25MG E 0,5 MG"'],
  ['7896382709111', 2.5, null, 'manutencao', 4, 'Mounjaro 2,5mg — 5MG/ML×0,5ml; qtd "4 SER PREENC"'],
  ['7896382709135', 5, null, 'manutencao', 4, 'Mounjaro 5mg — 10MG/ML×0,5ml; "4 SER PREENC"'],
  ['7896382709159', 7.5, null, 'manutencao', 4, 'Mounjaro 7,5mg — 15MG/ML×0,5ml; "4 SER PREENC"'],
  ['7896382709173', 10, null, 'manutencao', 4, 'Mounjaro 10mg — 20MG/ML×0,5ml; "4 SER PREENC"'],
  ['7896382709197', 12.5, null, 'manutencao', 4, 'Mounjaro 12,5mg — 25MG/ML×0,5ml; "4 SER PREENC"'],
  ['7896382709210', 15, null, 'manutencao', 4, 'Mounjaro 15mg — 30MG/ML×0,5ml; "4 SER PREENC"'],
  ['7897705203583', 0.25, 0.5, 'inicio', null, 'Extensior starter 0,25/0,5 — apres "DOSES 0,25MG E 0,5 MG"'],
  ['7897705203590', 1, null, 'manutencao', null, 'Extensior 1mg — apres "DOSES 1 MG"'],
  ['7896004796574', 0.25, 0.5, 'inicio', null, 'Ozivy starter 0,25/0,5 — 1,5ml+6 AGU (padrão starter Ozempic; aprovado sem DOSES)'],
  ['7896004796581', 1, null, 'manutencao', null, 'Ozivy 1mg — 1,34MG/ML×3ml÷4 AGU'],
  ['7896004798059', 1, null, 'manutencao', null, 'Ozivy 1mg embalagem dupla — 2 CAR×3ml÷8 AGU'],
  ['7897705203606', 0.25, null, 'inicio', null, 'Poviztra 0,25mg (0,68MG/ML) — 0,25=titulação SEMPRE inicio (correção clínica)'],
  ['7897705203613', 0.5, null, 'manutencao', null, 'Poviztra 0,5mg — 1,34MG/ML×1,5ml÷4 AGU'],
  ['7897705203620', 1, null, 'manutencao', null, 'Poviztra 1mg — 1,34MG/ML×3ml÷4 AGU'],
  ['7897705203637', 1.7, null, 'manutencao', null, 'Poviztra 1,7mg — 2,27MG/ML×3ml÷4 AGU'],
  ['7897705203644', 2.4, null, 'manutencao', null, 'Poviztra 2,4mg — 3,2MG/ML×3ml÷4 AGU'],
  ['7897705203071', 0.25, null, 'inicio', null, 'Wegovy 0,25mg (0,68MG/ML) — 0,25=titulação SEMPRE inicio (correção clínica)'],
  ['7897705203088', 0.5, null, 'manutencao', null, 'Wegovy 0,5mg — 1,34MG/ML×1,5ml÷4 AGU'],
  ['7897705203095', 1, null, 'manutencao', null, 'Wegovy 1mg — 1,34MG/ML×3ml÷4 AGU'],
  ['7897705203101', 1.7, null, 'manutencao', null, 'Wegovy 1,7mg exclusiva — 2,27MG/ML×3ml÷4 AGU'],
  ['7897705203118', 2.4, null, 'manutencao', null, 'Wegovy 2,4mg exclusiva — 3,2MG/ML×3ml÷4 AGU'],
];

// registros oficiais da `medicamento` (rastreabilidade)
const eans = CURADO.map((r) => r[0]);
const [regs] = await pool.query('SELECT ean, registro FROM medicamento WHERE ean IN (' + eans.map(() => '?').join(',') + ')', eans);
const regOf = new Map(regs.map((r) => [r.ean, r.registro]));

const vals = CURADO.map(([ean, f, mx, papel, qtd, nota]) => [ean, regOf.get(ean) || null, f, mx, 'mg', 'semana', papel, qtd, 'lupa STEP6 + apresentacao CMED', 'cluster2', nota]);

const conn = await pool.getConnection();
try {
  await conn.beginTransaction();
  const [r] = await conn.query(
    `INSERT INTO medicamento_curado (ean, registro, forca_valor, forca_valor_max, forca_unidade, forca_periodicidade, papel, qtd_embalagem_corr, fonte_curadoria, curado_por, nota)
     VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',')}
     ON DUPLICATE KEY UPDATE registro=VALUES(registro), forca_valor=VALUES(forca_valor), forca_valor_max=VALUES(forca_valor_max),
       forca_unidade=VALUES(forca_unidade), forca_periodicidade=VALUES(forca_periodicidade), papel=VALUES(papel),
       qtd_embalagem_corr=VALUES(qtd_embalagem_corr), fonte_curadoria=VALUES(fonte_curadoria), nota=VALUES(nota)`,
    vals.flat());
  const [[c]] = await conn.query('SELECT COUNT(*) n FROM medicamento_curado');
  await conn.commit();
  console.log(`✅ COMMIT · ${vals.length} linhas curadas (affectedRows=${r.affectedRows}) · total na tabela=${c.n}`);
} catch (e) { await conn.rollback(); console.error('ROLLBACK:', e.message); process.exitCode = 1; }
finally { conn.release(); }
await closePool();

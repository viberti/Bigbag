// Relatório READ-ONLY dos disparos do DRY-RUN (alerta_log) — a ferramenta de calibração do gatilho
// (8% / R$80) ANTES de ligar a entrega. Mostra cada alerta com contexto suficiente para o dono
// JULGAR À MÃO se é um alerta que mandaria a um humano, + contagem por dia. Não escreve nada.
//   Uso: node --env-file=.env scripts/relatorio_alertas.mjs [dias=30]
import { getPool, closePool } from '../src/db.js';
const dias = Math.min(365, Math.max(1, Number(process.argv[2]) || 30));
const pool = getPool();

const [alertas] = await pool.query(
  `SELECT a.id, a.disparado_em, a.utilizador, a.ean, m.produto, a.preco_gatilho, a.baseline_no_momento,
          a.desconto_pct, a.fonte, a.disponivel, a.preco_cond, a.preco_cond_fonte, a.preco_cond_obs, a.entregue
     FROM alerta_log a LEFT JOIN medicamento m ON m.ean = a.ean
    WHERE a.disparado_em >= (NOW() - INTERVAL ? DAY)
    ORDER BY a.disparado_em DESC`, [dias]);

console.log(`\n═══ DRY-RUN — disparos dos últimos ${dias} dias (${alertas.length}) ═══`);
console.log(`(entregue=0 = ainda não enviado; a entrega é a tarefa seguinte)\n`);
for (const a of alertas) {
  const cond = a.preco_cond != null ? `  | cond R$${a.preco_cond} @${a.preco_cond_fonte}${a.preco_cond_obs ? ` (${String(a.preco_cond_obs).slice(0, 40)})` : ''}` : '';
  console.log(`#${a.id} ${a.disparado_em.toISOString().slice(0, 16).replace('T', ' ')} · ${a.produto || '?'} (${a.ean})`);
  console.log(`   R$${a.preco_gatilho} @${a.fonte} · -${a.desconto_pct}% vs baseline R$${a.baseline_no_momento} · estoque=${a.disponivel} · usuário=${a.utilizador} · entregue=${a.entregue}${cond}`);
}
const [[c]] = await pool.query(
  `SELECT COUNT(*) total, SUM(entregue=0) nao_entregues, COUNT(DISTINCT utilizador) usuarios, COUNT(DISTINCT ean) eans
     FROM alerta_log WHERE disparado_em >= (NOW() - INTERVAL ? DAY)`, [dias]);
console.log(`\nResumo: ${c.total} disparos · ${c.nao_entregues} não-entregues · ${c.usuarios} usuários · ${c.eans} apresentações`);
await closePool();

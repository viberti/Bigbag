// Motor de gatilho do Trilho A (DRY-RUN). Avalia cada `usuario_monitor` ativo contra o ÚLTIMO
// snapshot do monitor denso (medicamento_monitor_hist) e GRAVA em `alerta_log` com entregue=0 o
// que TERIA alertado. NÃO envia nada — a entrega (push) é a tarefa seguinte, que lê os não-entregues.
//
// Ordem barato-primeiro (log legível), por monitor:
//   a) último snapshot por (ean,fonte)
//   b) filtra estoque (disponivel=1) se exige_estoque → razão 'sem_estoque' se nada sobra
//   c) menor preço de TABELA (campo preco, NÃO preco_cond) entre as com estoque
//   d) gatilho: preco <= baseline*(1-limiar/100) E (baseline-preco) >= piso_abs (AMBOS) → senão 'acima_do_limiar'
//   e) cooldown: ultimo_alerta_em + cooldown_horas ainda corre → 'cooldown'
//   f) dispara: grava alerta_log (entregue=0) + atualiza ultimo_alerta_em
// preco_cond (PBM) é INFORMATIVO: capturado p/ o alerta, nunca dispara. Bônus de calibração:
// conta quantos DISPARARIAM se o gatilho fosse sobre preco_cond (sem agir).
import { getPool } from '../db.js';

export async function avaliarAlertas({ log = console.log } = {}) {
  const pool = getPool();
  const [monitores] = await pool.query(
    `SELECT *, (ultimo_alerta_em IS NOT NULL AND DATE_ADD(ultimo_alerta_em, INTERVAL cooldown_horas HOUR) > NOW()) AS em_cooldown
       FROM usuario_monitor WHERE ativo = 1`);
  const razoes = { sem_estoque: 0, acima_do_limiar: 0, cooldown: 0 };
  let disparos = 0, dispararia_cond = 0;

  for (const m of monitores) {
    // a) último snapshot por (ean, fonte)
    const [snaps] = await pool.query(
      `SELECT t.fonte, t.preco, t.preco_cond, t.disponivel FROM medicamento_monitor_hist t
         JOIN (SELECT fonte, MAX(capturado_em) mx FROM medicamento_monitor_hist WHERE ean = ? GROUP BY fonte) g
           ON g.fonte = t.fonte AND g.mx = t.capturado_em
        WHERE t.ean = ?`, [m.ean, m.ean]);

    // b) filtra estoque ANTES de calcular
    let ofertas = snaps.filter((s) => s.preco != null && Number(s.preco) > 0);
    if (m.exige_estoque) ofertas = ofertas.filter((s) => s.disponivel === 1);
    if (!ofertas.length) { razoes.sem_estoque++; continue; }

    // c) menor preço de TABELA
    ofertas.sort((a, b) => Number(a.preco) - Number(b.preco));
    const melhor = ofertas[0];
    const preco = Number(melhor.preco);
    const baseline = Number(m.baseline_declarado);
    const limiarPreco = baseline * (1 - Number(m.limiar_pct) / 100);

    // cond informativo (menor preco_cond entre as com estoque) + bônus de calibração
    const comCond = ofertas.filter((s) => s.preco_cond != null).sort((a, b) => Number(a.preco_cond) - Number(b.preco_cond));
    const melhorCond = comCond[0] || null;
    if (melhorCond) {
      const pc = Number(melhorCond.preco_cond);
      if (pc <= limiarPreco && (baseline - pc) >= Number(m.piso_abs)) dispararia_cond++;
    }

    // d) gatilho sobre TABELA: limiar E piso simultâneos
    if (!(preco <= limiarPreco && (baseline - preco) >= Number(m.piso_abs))) { razoes.acima_do_limiar++; continue; }

    // e) cooldown
    if (m.em_cooldown) { razoes.cooldown++; continue; }

    // f) DISPARA (dry-run: entregue=0)
    const desconto = Math.round(((baseline - preco) / baseline) * 1000) / 10;
    let condObs = null;
    if (melhorCond) {
      const [[c]] = await pool.query('SELECT preco_cond_obs FROM catalogo_produto WHERE ean = ? AND fonte = ? LIMIT 1', [m.ean, melhorCond.fonte]);
      condObs = c ? c.preco_cond_obs : null;
    }
    await pool.query(
      `INSERT INTO alerta_log (monitor_id, utilizador, ean, preco_gatilho, baseline_no_momento, desconto_pct, fonte, disponivel, preco_cond, preco_cond_fonte, preco_cond_obs, entregue)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
      [m.id, m.utilizador, m.ean, preco, baseline, desconto, melhor.fonte, melhor.disponivel ? 1 : 0,
        melhorCond ? Number(melhorCond.preco_cond) : null, melhorCond ? melhorCond.fonte : null, condObs]);
    await pool.query('UPDATE usuario_monitor SET ultimo_alerta_em = NOW() WHERE id = ?', [m.id]);
    disparos++;
    log(`[motor] DISPARO ${m.utilizador} ean=${m.ean} R$${preco} @${melhor.fonte} (-${desconto}% vs baseline R$${baseline})`);
  }

  log(`[motor] avaliados=${monitores.length} disparos=${disparos} · não-disparo: sem_estoque=${razoes.sem_estoque} acima_do_limiar=${razoes.acima_do_limiar} cooldown=${razoes.cooldown} · (calibração) dispararia_cond=${dispararia_cond}`);
  return { avaliados: monitores.length, disparos, razoes, dispararia_cond };
}

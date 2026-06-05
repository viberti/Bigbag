// Registo e resumo de custo das chamadas ao modelo (OpenRouter).
import { getPool } from './db.js';

// Fire-and-forget: nunca atrasar ou falhar a resposta por causa do log.
export async function registrarCusto({ contexto, modelo, usage }, { db = getPool() } = {}) {
  if (!usage) return;
  try {
    await db.query(
      'INSERT INTO custo_chamada (contexto, modelo, prompt_tokens, completion_tokens, custo) VALUES (?,?,?,?,?)',
      [
        String(contexto || 'geral').slice(0, 30),
        String(modelo || '').slice(0, 60),
        Number(usage.prompt_tokens) || 0,
        Number(usage.completion_tokens) || 0,
        Number(usage.cost) || 0,
      ],
    );
  } catch {
    /* ignora — telemetria não deve quebrar nada */
  }
}

// Qualidade da EXTRAÇÃO por modelo/método — usa o sinal de reconciliação
// (objetivo): taxa que reconcilia e discrepância média. Compara flash vs lite.
export async function resumoQualidade({ db = getPool() } = {}) {
  const [porModelo] = await db.query(
    `SELECT COALESCE(modelo, '(antes do registo)') AS modelo,
            metodo_extracao AS metodo,
            COUNT(*) AS faturas,
            SUM(needs_review = 0) AS reconciliam,
            ROUND(100 * SUM(needs_review = 0) / COUNT(*), 1) AS taxa_ok_pct,
            ROUND(AVG(ABS(discrepancia)), 3) AS discrepancia_media
     FROM fatura
     GROUP BY modelo, metodo_extracao
     ORDER BY faturas DESC`,
  );
  return { extracao_por_modelo: porModelo };
}

export async function resumoCustos({ db = getPool() } = {}) {
  const [[total]] = await db.query('SELECT COUNT(*) AS chamadas, ROUND(SUM(custo), 6) AS custo_total_usd FROM custo_chamada');
  const [porContexto] = await db.query(
    'SELECT contexto, COUNT(*) AS chamadas, ROUND(SUM(custo), 6) AS custo_usd FROM custo_chamada GROUP BY contexto ORDER BY custo_usd DESC',
  );
  const [porModelo] = await db.query(
    'SELECT modelo, COUNT(*) AS chamadas, ROUND(SUM(custo), 6) AS custo_usd FROM custo_chamada GROUP BY modelo ORDER BY custo_usd DESC',
  );
  return { total: total.custo_total_usd || 0, chamadas: total.chamadas || 0, por_contexto: porContexto, por_modelo: porModelo };
}

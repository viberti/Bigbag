// FILA DE NOTAS EM FUNDO (dono, 2026-06-27): o upload de talão deixa de ser síncrono.
// O POST guarda a imagem + cria um job 'em_analise' e responde já; este módulo corre o
// pipeline (processarNotaDeFicheiro) em fundo e fecha o job em pronto/precisa_revisao/falhou.
// Tolerância a falhas: cada tentativa marca lease_em+tentativas; um job preso (reinício do
// serviço a meio) é re-apanhado por varrerPendentes; após MAX_TENT erros fica 'falhou'.
import { readFile } from 'node:fs/promises';
import { processarNotaDeFicheiro } from './processarNota.js';

const MAX_TENT = 3;

// Cria o job 'em_analise' (a imagem já foi gravada no disco pelo chamador). Devolve o id.
export async function criarJob(pool, { ficheiro, mime, metodo = 'vlm', origemCaptura = null, userId = null }) {
  const [r] = await pool.query(
    `INSERT INTO fatura_job (usuario_id, ficheiro_original, mime, metodo, origem_captura, estado)
     VALUES (?, ?, ?, ?, ?, 'em_analise')`,
    [userId || null, ficheiro, mime || null, metodo, origemCaptura],
  );
  return r.insertId;
}

// Processa UM job. Idempotente por estado: só age se ainda 'em_analise'. A 1.ª linha
// "arrenda" o job (lease + tentativas++) numa escrita atómica — duas chamadas concorrentes
// (fire-and-forget + varredura) não o processam duas vezes.
export async function processarJob(pool, jobId) {
  const [upd] = await pool.query(
    "UPDATE fatura_job SET lease_em = NOW(), tentativas = tentativas + 1 WHERE id = ? AND estado = 'em_analise'",
    [jobId],
  );
  if (!upd.affectedRows) return; // já não está em_analise (processado/arrendado por outro)
  const [[job]] = await pool.query('SELECT * FROM fatura_job WHERE id = ?', [jobId]);
  if (!job) return;
  try {
    const buffer = await readFile(job.ficheiro_original);
    const r = await processarNotaDeFicheiro(pool, {
      buffer,
      mime: job.mime,
      originalname: job.ficheiro_original,
      ficheiroOriginal: job.ficheiro_original,
      origemCaptura: job.origem_captura,
      userId: job.usuario_id,
    });
    const estado = r.needs_review ? 'precisa_revisao' : 'pronto';
    await pool.query(
      `UPDATE fatura_job SET estado = ?, fatura_id = ?, duplicada = ?, n_itens = ?, loja_nome = ?, total = ?, data_compra = ?, erro = NULL
         WHERE id = ?`,
      [
        estado,
        r.fatura_id || null,
        r.duplicada ? 1 : 0,
        r.n_itens ?? null,
        (r.loja?.cadeia || r.loja?.nome || null)?.slice(0, 120) || null,
        r.total_impresso ?? null,
        r.data_compra ? String(r.data_compra).slice(0, 10) : null,
        jobId,
      ],
    );
    return estado;
  } catch (e) {
    // Falha hoje, acerta amanhã: até MAX_TENT volta a 'em_analise' (a varredura repete
    // após o lease expirar); a partir daí fica 'falhou' com a mensagem, p/ o user repetir.
    // `semRetry` (ex.: talão sem valores) é determinístico → falha JÁ, sem gastar tentativas.
    const falhou = e.semRetry === true || (job.tentativas || 1) >= MAX_TENT;
    console.error('[filaNotas] job', jobId, falhou ? 'FALHOU:' : 'erro (vai repetir):', e.message);
    await pool.query(
      'UPDATE fatura_job SET estado = ?, erro = ?, lease_em = NULL WHERE id = ?',
      [falhou ? 'falhou' : 'em_analise', String(e.message || 'erro').slice(0, 255), jobId],
    );
    return falhou ? 'falhou' : 'em_analise';
  }
}

// Varre jobs 'em_analise' PRESOS (sem lease ou com lease velho → reinício do worker) e
// re-processa-os. Lote pequeno + baixa frequência (custo controlado; o VLM é CPU/€ partilhado).
export async function varrerPendentes(pool, { lote = 2, presoMin = 4 } = {}) {
  const [pend] = await pool.query(
    `SELECT id FROM fatura_job
       WHERE estado = 'em_analise' AND tentativas < ?
         AND (lease_em IS NULL OR lease_em < (NOW() - INTERVAL ? MINUTE))
       ORDER BY criado_em LIMIT ?`,
    [MAX_TENT, presoMin, lote],
  );
  for (const p of pend) await processarJob(pool, p.id); // sequencial: não saturar o VLM
  return pend.length;
}

// Re-enfileira um job 'falhou' (botão "tentar outra vez" do utilizador).
export async function repetirJob(pool, jobId, userId = null) {
  const [r] = await pool.query(
    `UPDATE fatura_job SET estado = 'em_analise', tentativas = 0, lease_em = NULL, erro = NULL
       WHERE id = ? AND estado = 'falhou'${userId ? ' AND usuario_id = ?' : ''}`,
    userId ? [jobId, userId] : [jobId],
  );
  return r.affectedRows > 0;
}

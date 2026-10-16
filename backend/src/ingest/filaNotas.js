// FILA DE NOTAS EM FUNDO (dono, 2026-06-27): o upload de talão deixa de ser síncrono.
// O POST guarda a imagem + cria um job 'em_analise' e responde já; este módulo corre o
// pipeline (processarNotaDeFicheiro) em fundo e fecha o job em pronto/precisa_revisao/falhou.
// Tolerância a falhas: cada tentativa marca lease_em+tentativas; um job preso (reinício do
// serviço a meio) é re-apanhado por varrerPendentes; após MAX_TENT erros fica 'falhou'.
import { readFile } from 'node:fs/promises';
import { processarNotaDeFicheiro, posPersistencia } from './processarNota.js';

const MAX_TENT = 3;
const LEASE_MIN = 4;          // lease mais velho que isto = worker morreu → outro pode pegar
const RENOVA_MS = 60_000;     // enquanto processa, renova o lease (talão denso pode passar dos 4 min)

// Cria o job 'em_analise' (a imagem já foi gravada no disco pelo chamador). Devolve o id.
export async function criarJob(pool, { ficheiro, mime, metodo = 'vlm', origemCaptura = null, userId = null }) {
  const [r] = await pool.query(
    `INSERT INTO fatura_job (usuario_id, ficheiro_original, mime, metodo, origem_captura, estado)
     VALUES (?, ?, ?, ?, ?, 'em_analise')`,
    [userId || null, ficheiro, mime || null, metodo, origemCaptura],
  );
  return r.insertId;
}

// Processa UM job. A 1.ª linha "arrenda" o job numa escrita atómica que SÓ pega um job livre
// (sem lease, ou com lease velho = worker morreu) — duas chamadas concorrentes (POST/retry +
// varredura) não o processam duas vezes. (Antes só testava o estado: as duas pegavam — caso
// real job 131, 2026-10-16: duas leituras VLM pagas.) Enquanto processa, renova o lease.
export async function processarJob(pool, jobId) {
  const [upd] = await pool.query(
    `UPDATE fatura_job SET lease_em = NOW(), tentativas = tentativas + 1
      WHERE id = ? AND estado = 'em_analise' AND (lease_em IS NULL OR lease_em < (NOW() - INTERVAL ? MINUTE))`,
    [jobId, LEASE_MIN],
  );
  if (!upd.affectedRows) return; // já não está em_analise, ou outro worker tem-no em mãos
  const [[job]] = await pool.query('SELECT * FROM fatura_job WHERE id = ?', [jobId]);
  if (!job) return;
  const renova = setInterval(() => {
    pool.query("UPDATE fatura_job SET lease_em = NOW() WHERE id = ? AND estado = 'em_analise'", [jobId]).catch(() => {});
  }, RENOVA_MS);
  renova.unref?.();
  try {
    // RETOMAR: já há uma fatura gravada a partir DESTE ficheiro → a tentativa anterior morreu
    // depois de gravar. Não re-extrai (não paga o VLM outra vez) nem a trata como duplicada:
    // corre só os passos pós-gravação que podem ter ficado por fazer.
    const [[ja]] = await pool.query(
      `SELECT f.id, f.needs_review, f.total_impresso, f.data_compra, COALESCE(l.cadeia, l.nome) AS loja,
              (SELECT COUNT(*) FROM item i WHERE i.fatura_id = f.id) AS n_itens
         FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.ficheiro_original = ? LIMIT 1`,
      [job.ficheiro_original]);
    if (ja) {
      const { verificacao } = await posPersistencia(pool, ja.id, { cadeia: ja.loja });
      const estado = ja.needs_review ? 'precisa_revisao' : 'pronto';
      await pool.query(
        `UPDATE fatura_job SET estado = ?, fatura_id = ?, duplicada = 0, n_itens = ?, loja_nome = ?, total = ?, data_compra = ?,
                erro = NULL, verificacao_nomes = ? WHERE id = ?`,
        [estado, ja.id, ja.n_itens, String(ja.loja || '').slice(0, 120) || null, ja.total_impresso, String(ja.data_compra).slice(0, 10),
          verificacao?.estado || null, jobId]);
      console.log(`[filaNotas] job ${jobId}: fatura ${ja.id} já gravada — retomados os passos pós-gravação`);
      return estado;
    }
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
      `UPDATE fatura_job SET estado = ?, fatura_id = ?, duplicada = ?, n_itens = ?, loja_nome = ?, total = ?, data_compra = ?, erro = NULL,
              verificacao_nomes = ?
         WHERE id = ?`,
      [
        estado,
        r.fatura_id || null,
        r.duplicada ? 1 : 0,
        r.n_itens ?? null,
        (r.loja?.cadeia || r.loja?.nome || null)?.slice(0, 120) || null,
        r.total_impresso ?? null,
        r.data_compra ? String(r.data_compra).slice(0, 10) : null,
        r.verificacao_nomes || null,
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
  } finally {
    clearInterval(renova);
  }
}

// Varre jobs 'em_analise' PRESOS (sem lease ou com lease velho → reinício do worker) e
// re-processa-os. Lote pequeno + baixa frequência (custo controlado; o VLM é CPU/€ partilhado).
export async function varrerPendentes(pool, { lote = 2, presoMin = LEASE_MIN } = {}) {
  // Job que MORREU na última tentativa (reinício a meio da 3.ª): tentativas já = MAX e o catch
  // nunca correu → ficava 'em_analise' para sempre (a varredura saltava-o e o "Repetir" só aceita
  // 'falhou'). Fecha-o como 'falhou' para o utilizador poder repetir.
  await pool.query(
    `UPDATE fatura_job SET estado = 'falhou', erro = 'Interrompido (o serviço reiniciou a meio). Tente de novo.', lease_em = NULL
      WHERE estado = 'em_analise' AND tentativas >= ? AND lease_em IS NOT NULL AND lease_em < (NOW() - INTERVAL ? MINUTE)`,
    [MAX_TENT, presoMin]);
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

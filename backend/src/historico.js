// Histórico de conversa por utilizador — dá memória à consulta.
import { getPool } from './db.js';

// Mensagens recentes no formato do LLM ([{role, content}]), por ordem cronológica.
export async function carregarHistorico(utilizador, { db = getPool(), limite = 20 } = {}) {
  const n = Math.max(1, Math.min(Number(limite) || 20, 100));
  const [rows] = await db.query(
    `SELECT papel, conteudo FROM mensagem WHERE utilizador = ? ORDER BY id DESC LIMIT ${n}`,
    [utilizador],
  );
  return rows.reverse().map((m) => ({ role: m.papel, content: m.conteudo }));
}

export async function guardarMensagem(utilizador, papel, conteudo, { db = getPool() } = {}) {
  await db.query('INSERT INTO mensagem (utilizador, papel, conteudo) VALUES (?,?,?)', [
    utilizador,
    papel,
    String(conteudo || '').slice(0, 4000),
  ]);
}

// Para a PWA mostrar a conversa ao abrir (com hora).
export async function listarHistorico(utilizador, { db = getPool(), limite = 50 } = {}) {
  const n = Math.max(1, Math.min(Number(limite) || 50, 200));
  const [rows] = await db.query(
    `SELECT papel, conteudo, DATE_FORMAT(criado_em, '%H:%i') AS hora
       FROM mensagem WHERE utilizador = ? ORDER BY id DESC LIMIT ${n}`,
    [utilizador],
  );
  return rows.reverse();
}

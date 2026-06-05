// Memória de longo prazo — perfil do usuário (fatos/preferências duráveis).
import { getPool } from './db.js';

export async function carregarPerfil(utilizador, { db = getPool(), limite = 50 } = {}) {
  const n = Math.max(1, Math.min(Number(limite) || 50, 200));
  const [rows] = await db.query(
    `SELECT fato FROM perfil WHERE utilizador = ? ORDER BY id ASC LIMIT ${n}`,
    [utilizador],
  );
  return rows.map((r) => r.fato);
}

export async function guardarFato(utilizador, fato, { db = getPool() } = {}) {
  const f = String(fato || '').trim().slice(0, 300);
  if (!f) return false;
  await db.query('INSERT IGNORE INTO perfil (utilizador, fato) VALUES (?, ?)', [utilizador, f]);
  return true;
}

export async function esquecerFato(utilizador, fato, { db = getPool() } = {}) {
  await db.query('DELETE FROM perfil WHERE utilizador = ? AND fato = ?', [utilizador, String(fato || '').trim()]);
}

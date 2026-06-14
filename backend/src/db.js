// Camada de acesso à BD (MySQL via mysql2/promise).
// Um pool partilhado, criado a partir da config (.env). As queries vivem
// em queries.js; aqui só a ligação e helpers de transação.
import mysql from 'mysql2/promise';
import { config } from './config.js';

let pool;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.name,
      waitForConnections: true,
      connectionLimit: 5,
      charset: 'utf8mb4',
      // DECIMAL como número (e não string) para as somas/comparações de preço.
      decimalNumbers: true,
    });
  }
  return pool;
}

// Valor de uma coluna que guarda JSON. O mysql2 devolve OBJETO para colunas tipo
// JSON (catalogo_produto.nutricao, produto_ean.fusao, fatura.extracao_json) e
// STRING para colunas TEXT que guardam JSON. Aceita ambos (+ null/corrompido → null).
// USAR ISTO, nunca JSON.parse cru sobre valor da BD — JSON.parse(objeto) rebenta.
// Fonte ÚNICA da verdade para parse de colunas JSON.
export function parseJsonCol(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v; // já vem objeto/array (coluna tipo JSON)
  try { return JSON.parse(v); } catch { return null; }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

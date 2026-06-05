// Cliente da API de exploração (/api/explorar). Reusa a auth Basic do api.js.
import { getAuth } from './api.js';

async function jget(path) {
  const headers = {};
  const auth = getAuth();
  if (auth) headers.Authorization = `Basic ${auth}`;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export const listarProdutos = (q, mes) =>
  jget(`/api/explorar/produtos?q=${encodeURIComponent(q || '')}${mes ? `&mes=${mes}` : ''}`);
export const carregarProduto = (id) => jget(`/api/explorar/produtos/${id}`);
export const listarMeses = () => jget('/api/explorar/meses');

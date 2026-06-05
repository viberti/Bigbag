// Cliente da API de operador (/api/admin). Reusa a auth Basic do api.js.
import { getAuth } from './api.js';

async function call(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const auth = getAuth();
  if (auth) headers.Authorization = `Basic ${auth}`;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res;
}
const jget = async (p) => (await call(p)).json();
const jsend = async (p, method, body) =>
  (await call(p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

// SKUs
export const listarSkus = (q) => jget(`/api/admin/skus?limit=300${q ? '&q=' + encodeURIComponent(q) : ''}`);
export const carregarSku = (id) => jget(`/api/admin/skus/${id}`);
export const renomearSku = (id, dados) => jsend(`/api/admin/skus/${id}`, 'PATCH', dados);
export const associar = (id, descricao) => jsend(`/api/admin/skus/${id}/associar`, 'POST', { descricao });
export const dissociar = (id, descricao) => jsend(`/api/admin/skus/${id}/dissociar`, 'POST', { descricao });
export const fundirSkus = (de, para) => jsend('/api/admin/skus/merge', 'POST', { de, para });
export const sugestoesMerge = (limiar) => jget(`/api/admin/sugestoes-merge?limiar=${limiar}`);
export const autoMergeIdenticos = () => jsend('/api/admin/skus/auto-merge', 'POST', {});
export const qualidade = () => jget('/api/admin/qualidade');

// Notas
export const listarNotas = (status) => jget(`/api/admin/faturas?status=${status || 'all'}&limit=300`);
export const carregarNota = (id) => jget(`/api/admin/faturas/${id}`);
export const revisarNota = (id, veredicto, comentario) =>
  jsend(`/api/admin/faturas/${id}/revisao`, 'POST', { veredicto, comentario });
export const atualizarItem = (id, quantidade) => jsend(`/api/admin/itens/${id}`, 'PATCH', { quantidade });

// Imagem (precisa de auth → object URL). Lembrar de revokeObjectURL.
export async function carregarImagem(id) {
  const r = await call(`/api/faturas/${id}/imagem`);
  return URL.createObjectURL(await r.blob());
}

// Ficheiro da nota com deteção de tipo (PDF vs imagem) pelo content-type.
export async function carregarFicheiro(id) {
  const r = await call(`/api/faturas/${id}/imagem`);
  const blob = await r.blob();
  return { url: URL.createObjectURL(blob), pdf: blob.type === 'application/pdf' };
}

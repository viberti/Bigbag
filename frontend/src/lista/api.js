// Cliente da app "Lista" (/lista). Usa o MESMO servidor e o MESMO login do BigBag (o token
// vive no localStorage da mesma origem), mas fala com a SUA lista: todas as chamadas a
// /api/lista levam `X-Lista: simples` (migr. 099; backend/src/listaId.js). O resto
// (autocomplete, voz, código de barras, sessão) é partilhado tal e qual.
import { call, clearAuth } from '../api.js';
import { logout } from '../auth/local.js';

export { verificarSessao, autocompleteProduto, consultarProdutoEan, vozParaLista } from '../api.js';
export { login } from '../auth/local.js';

const LISTA = 'simples';
// Sair: limpa o token E a credencial Basic antiga (senão uma sessão legada sobrevivia ao "Sair").
export function sair() { logout(); clearAuth(); }
const comLista = (opts = {}) => ({ ...opts, headers: { ...(opts.headers || {}), 'X-Lista': LISTA } });
const json = (body) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function ok(r, oque) {
  if (!r.ok) throw new Error(`${oque} ${r.status}`);
  return r.json();
}

// GET com ETag/304 (polling barato enquanto a app está aberta).
export async function obterLista(etag) {
  const r = await call('/api/lista', comLista(etag ? { headers: { 'If-None-Match': etag } } : {}));
  if (r.status === 304) return { naoMudou: true, etag };
  const data = await ok(r, 'lista');
  return { ...data, etag: r.headers.get('ETag') };
}
export async function adicionar({ nome, quantidade, ean }) {
  return ok(await call('/api/lista', comLista({ method: 'POST', ...json({ nome, quantidade, ean }) })), 'adicionar');
}
export async function adicionarLote(produtos) {
  return ok(await call('/api/lista/lote', comLista({ method: 'POST', ...json({ produtos }) })), 'lote');
}
export async function atualizar(id, dados) {
  return ok(await call(`/api/lista/${id}`, comLista({ method: 'PATCH', ...json(dados) })), 'atualizar');
}
export async function remover(id) {
  return ok(await call(`/api/lista/${id}`, comLista({ method: 'DELETE' })), 'remover');
}
// Concluir a ida às compras: os riscados passam a 'comprado' (histórico), não a 'removido'.
export async function concluir() {
  return ok(await call('/api/lista/concluir', comLista({ method: 'POST' })), 'concluir');
}
export async function limpar() {
  return ok(await call('/api/lista/limpar', comLista({ method: 'POST' })), 'limpar');
}
export async function restaurar(itens) {
  return ok(await call('/api/lista/restaurar', comLista({ method: 'POST', ...json({ itens }) })), 'restaurar');
}
export async function sugestoes() {
  const d = await ok(await call('/api/lista/sugestoes', comLista()), 'sugestoes');
  return d.sugestoes || [];
}

// Habituais da casa na FORMA GERAL (sem marca, sem repetidos) — chips "talvez precise de".
export async function habituais() {
  const d = await ok(await call('/api/lista/habituais', comLista()), 'habituais');
  return d.produtos || [];
}

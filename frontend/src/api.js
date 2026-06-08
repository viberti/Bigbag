// Cliente da API. Auth temporária: HTTP Basic (portão gustavo/sue) guardado em
// localStorage. Quando o OAuth entrar, troca-se por sessão/cookie.
const AUTH_KEY = 'bigbag_auth';

export const getAuth = () => localStorage.getItem(AUTH_KEY);
export const setAuth = (user, pass) => localStorage.setItem(AUTH_KEY, btoa(`${user}:${pass}`));
export const clearAuth = () => localStorage.removeItem(AUTH_KEY);

async function call(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const auth = getAuth();
  if (auth) headers.Authorization = `Basic ${auth}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    clearAuth();
    throw new Error('401');
  }
  return res;
}

export async function verificarSessao() {
  const r = await call('/api/me');
  if (!r.ok) throw new Error('falha');
  return r.json();
}

export async function carregarConversa() {
  const r = await call('/api/historico');
  if (!r.ok) return [];
  const { mensagens } = await r.json();
  return mensagens || [];
}

export async function carregarHabituais() {
  // Lança em falha (rede ou HTTP) para o chamador poder cair na cache offline.
  // Um 200 com lista vazia É uma resposta válida (devolve []), não um erro.
  const r = await call('/api/habituais');
  if (!r.ok) throw new Error(`habituais ${r.status}`);
  const { produtos } = await r.json();
  return produtos || [];
}

export async function historicoProduto(nome) {
  const r = await call(`/api/produto/historico?nome=${encodeURIComponent(nome)}`);
  if (!r.ok) throw new Error(`historico ${r.status}`);
  const { historico } = await r.json();
  return historico || [];
}

export async function consultar(pergunta) {
  const r = await call('/api/consulta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pergunta }),
  });
  return r.json();
}

export async function enviarFatura(file, origem) {
  const fd = new FormData();
  fd.append('fatura', file);
  if (origem) fd.append('origem', origem);
  const r = await call('/api/faturas', { method: 'POST', body: fd });
  return r.json();
}

export async function listarNotas() {
  const r = await call('/api/faturas');
  if (!r.ok) throw new Error(`notas ${r.status}`);
  const { notas } = await r.json();
  return notas || [];
}

export async function detalhesNota(id) {
  const r = await call(`/api/faturas/${id}`);
  if (!r.ok) throw new Error(`nota ${r.status}`);
  return r.json(); // { nota, itens }
}

export async function identificarProduto({ ean, skuId, itemId, fotos }) {
  const fd = new FormData();
  if (ean) fd.append('ean', ean);
  if (skuId) fd.append('sku_id', skuId);
  if (itemId) fd.append('item_id', itemId);
  (fotos || []).forEach((f) => fd.append('fotos', f));
  const r = await call('/api/produto/identificar', { method: 'POST', body: fd });
  if (!r.ok) {
    let msg = `identificar ${r.status}`;
    try { msg = (await r.json()).erro || msg; } catch { /* corpo não-JSON */ }
    throw new Error(msg);
  }
  return r.json(); // { ean, vlm, off, fonte, custo }
}

export async function resumoGastos() {
  const r = await call('/api/faturas/gastos');
  if (!r.ok) throw new Error(`gastos ${r.status}`);
  return r.json(); // { atual, anterior, media, total_geral, variacao, serie, por_loja }
}

export async function listarPorIdentificar() {
  const r = await call('/api/produto/por-identificar');
  if (!r.ok) throw new Error(`por-identificar ${r.status}`);
  const { itens } = await r.json();
  return itens || [];
}

export async function carregarPerfil({ nome, texto }) {
  const r = await call('/api/perfil', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, texto }) });
  if (!r.ok) throw new Error(`perfil ${r.status}`);
  return r.json();
}
export async function listarPerfis() {
  const r = await call('/api/perfil');
  if (!r.ok) throw new Error(`perfis ${r.status}`);
  const { perfis } = await r.json();
  return perfis || [];
}
export async function ativarPerfil(id) {
  const r = await call(`/api/perfil/${id}/ativar`, { method: 'POST' });
  if (!r.ok) throw new Error(`ativar ${r.status}`);
  return r.json();
}
export async function avaliacaoPersonalizada({ itemId, ean }) {
  const qs = itemId ? `item_id=${itemId}` : `ean=${encodeURIComponent(ean)}`;
  const r = await call(`/api/produto/personalizado?${qs}`);
  if (!r.ok) throw new Error(`personalizado ${r.status}`);
  return r.json(); // { perfil, alertas, avaliacao }
}

export async function consultarProdutoEan(ean) {
  const r = await call(`/api/produto/consultar?ean=${encodeURIComponent(ean)}`);
  if (!r.ok) throw new Error(`consultar ${r.status}`);
  return r.json(); // { ean, encontrado, fonte, nome }
}

export async function listarDespensa() {
  const r = await call('/api/produto/despensa');
  if (!r.ok) throw new Error(`despensa ${r.status}`);
  const { produtos } = await r.json();
  return produtos || [];
}

export async function infoProduto({ itemId, ean }) {
  const qs = itemId ? `item_id=${itemId}` : `ean=${encodeURIComponent(ean)}`;
  const r = await call(`/api/produto/info?${qs}`);
  if (!r.ok) throw new Error(`info ${r.status}`);
  return r.json(); // { ean, vlm, off, fonte, fotos, existe }
}

export async function analiseProduto({ itemId, ean, forcar }) {
  const qs = new URLSearchParams();
  if (itemId) qs.set('item_id', itemId);
  if (ean) qs.set('ean', ean);
  if (forcar) qs.set('forcar', '1');
  const r = await call(`/api/produto/analise?${qs}`);
  if (!r.ok) throw new Error(`analise ${r.status}`);
  return r.json(); // { analise, custo?, cacheada }
}

// Foto de produto (rota com auth → não dá para usar em <img src> direto).
// Busca o blob com o header e devolve um object URL.
export async function fotoProdutoUrl(id) {
  const r = await call(`/api/produto/foto/${id}`);
  if (!r.ok) throw new Error(`foto ${r.status}`);
  return URL.createObjectURL(await r.blob());
}

export async function enviarVoz(blob) {
  const fd = new FormData();
  const ext = (blob.type.split('/')[1] || 'webm').split(';')[0];
  fd.append('audio', blob, `nota.${ext}`);
  const r = await call('/api/voz', { method: 'POST', body: fd });
  return r.json();
}

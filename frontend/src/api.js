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

// Redimensiona/comprime uma imagem no BROWSER antes do upload (canvas): lado maior
// <= maxLado, JPEG na qualidade dada. Reduz drasticamente o tamanho (uploads em
// dados móveis + memória do servidor) sem perda útil (o VLM reduz a resolução na
// mesma). Respeita a orientação EXIF. Não-imagens (PDF) ou já pequenas → original.
export async function redimensionarImagem(file, { maxLado = 2000, qualidade = 0.82 } = {}) {
  if (!file || !/^image\//.test(file.type) || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    if (escala >= 1 && file.size < 900_000) { bitmap.close?.(); return file; }
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', qualidade));
    if (!blob || blob.size >= file.size) return file; // não piorar
    return new File([blob], String(file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // qualquer falha → envia o original
  }
}

export async function enviarFatura(file, origem) {
  const fd = new FormData();
  fd.append('fatura', await redimensionarImagem(file, { maxLado: 2200, qualidade: 0.85 }));
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
  const reduzidas = await Promise.all((fotos || []).map((f) => redimensionarImagem(f)));
  reduzidas.forEach((f) => fd.append('fotos', f));
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

export async function lerEanFoto(file) {
  const fd = new FormData();
  fd.append('foto', await redimensionarImagem(file, { maxLado: 2200, qualidade: 0.88 }));
  const r = await call('/api/produto/ler-ean', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`ler-ean ${r.status}`);
  return r.json(); // { ean }
}

export async function fotoInteligente(file) {
  const fd = new FormData();
  fd.append('foto', file);
  const r = await call('/api/produto/foto', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`foto ${r.status}`);
  return r.json(); // { tipo, ean?, encontrado?, nome?, marca?, lido? }
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

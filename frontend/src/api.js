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

export async function consultar(pergunta) {
  const r = await call('/api/consulta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pergunta }),
  });
  return r.json();
}

export async function enviarFatura(file) {
  const fd = new FormData();
  fd.append('fatura', file);
  const r = await call('/api/faturas', { method: 'POST', body: fd });
  return r.json();
}

export async function enviarVoz(blob) {
  const fd = new FormData();
  const ext = (blob.type.split('/')[1] || 'webm').split(';')[0];
  fd.append('audio', blob, `nota.${ext}`);
  const r = await call('/api/voz', { method: 'POST', body: fd });
  return r.json();
}

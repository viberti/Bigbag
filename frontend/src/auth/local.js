// Auth PRÓPRIA do BigBag (email+senha → o NOSSO JWT, guardado no localStorage).
// Substitui o login OIDC/Zitadel. O token vai como Bearer nas chamadas à API (ver api.js).
const TOKEN_KEY = 'bigbag_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Faz login. Devolve o `user` (com locale) ou atira Error com mensagem amigável.
export async function login(email, senha) {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim().toLowerCase(), senha }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || 'Falha no login.');
  setToken(data.token);
  return data.user;
}

export function logout() { clearToken(); }

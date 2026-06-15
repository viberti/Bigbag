// Portão de autenticação. Aceita, por ordem:
//  1) Bearer JWT do Zitadel (login OIDC real) — valida assinatura via JWKS do issuer,
//     confirma o issuer/expiração, e exige que o EMAIL esteja na allowlist do BigBag
//     (camada 2: só utilizadores pré-cadastrados/autorizados a ESTE app).
//  2) HTTP Basic + TEST_USERS (ENABLE_TEST_AUTH) — rede de segurança durante a
//     migração; remover quando o OIDC estiver 100%.
// A app está exposta à internet: nenhuma rota que gaste a chave OpenRouter ou
// escreva na BD pode ficar anónima.
import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.js';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function checkBasic(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  const user = decoded.slice(0, i); const pass = decoded.slice(i + 1);
  const match = config.auth.testUsers.find((u) => safeEqual(u.u, user) && safeEqual(u.p, pass));
  return match ? match.u : null;
}

// JWKS remoto do Zitadel (cacheado pela própria jose). Só se houver issuer.
const JWKS = config.auth.oidcIssuer ? createRemoteJWKSet(new URL(`${config.auth.oidcIssuer}/oauth/v2/keys`)) : null;
const emailCache = new Map(); // sub → email (evita /userinfo repetido)

// email do utilizador: do próprio token, senão do /userinfo (1× por sub, cacheado).
async function emailDoToken(payload, token) {
  let email = payload.email || null;
  if (email) return String(email).toLowerCase();
  const sub = payload.sub;
  if (emailCache.has(sub)) return emailCache.get(sub);
  try {
    const r = await fetch(`${config.auth.oidcIssuer}/oidc/v1/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const u = await r.json(); email = (u.email || '').toLowerCase() || null; emailCache.set(sub, email); return email; }
  } catch { /* rede falhou */ }
  return null;
}

async function checkBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ') || !JWKS) return null;
  const token = header.slice(7).trim();
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: config.auth.oidcIssuer });
    return { sub: payload.sub, email: await emailDoToken(payload, token) };
  } catch { return null; } // assinatura/issuer/expiração inválidos
}

export async function requireAuth(req, res, next) {
  // 1) login OIDC real (Zitadel) + allowlist
  const b = await checkBearer(req);
  if (b) {
    const al = config.auth.allowlist;
    if (al.length && (!b.email || !al.includes(b.email))) {
      return res.status(403).json({ erro: 'Conta sem acesso ao BigBag.', email: b.email || null });
    }
    req.user = { id: b.email || b.sub, email: b.email, sub: b.sub, via: 'oidc' };
    return next();
  }
  // 2) rede de segurança: test-auth (Basic) durante a migração
  if (config.auth.enableTestAuth) {
    const u = checkBasic(req);
    if (u) { req.user = { id: u, via: 'test-auth' }; return next(); }
  }
  // SEM `WWW-Authenticate: Basic` — esse header fazia o BROWSER abrir o diálogo
  // nativo de Basic Auth ao 1.º /api 401, sequestrando o ecrã ANTES do login OIDC
  // da app aparecer. A app trata a auth pela sua UI ("Entrar" → Zitadel; ou o form
  // de teste, que manda o Basic no header). 401 limpo → a app mostra o login.
  return res.status(401).json({ erro: 'Autenticação necessária' });
}

// Portão de autenticação — AUTH PRÓPRIA (sem IdP externo; só 2 utilizadores).
//  1) Bearer = o NOSSO JWT (HS256, assinado com AUTH_JWT_SECRET). Emitido por POST
//     /api/auth/login (email+senha verificada por hash scrypt na tabela `usuario`).
//  2) HTTP Basic + TEST_USERS (ENABLE_TEST_AUTH) — rede de segurança para os e2e.
// A app está exposta à internet: nenhuma rota que gaste a chave OpenRouter ou
// escreva na BD pode ficar anónima.
import { timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config, paisCfg } from './config.js';
import { getPool } from './db.js';

// ── SENHA: hash scrypt (sem dependências). Formato "scrypt$<saltHex>$<hashHex>".
export function hashSenha(senha) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(senha), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verificarSenha(senha, armazenado) {
  if (!armazenado || typeof armazenado !== 'string' || !armazenado.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = armazenado.split('$');
  if (!saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const teste = scryptSync(String(senha), Buffer.from(saltHex, 'hex'), 64);
  return esperado.length === teste.length && timingSafeEqual(esperado, teste);
}

// ── JWT próprio (HS256). O segredo vive só no .env.
const segredo = () => new TextEncoder().encode(config.auth.jwtSecret);
export async function assinarToken({ email, nome }) {
  if (!config.auth.jwtSecret) throw new Error('AUTH_JWT_SECRET em falta');
  return new SignJWT({ email, nome: nome || null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email).setIssuedAt().setExpirationTime(config.auth.tokenTtl)
    .sign(segredo());
}
async function checkBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ') || !config.auth.jwtSecret) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7).trim(), segredo());
    return { email: payload.email || payload.sub, nome: payload.nome || null };
  } catch { return null; } // assinatura/expiração inválidas
}

// PAÍS+LOCALE do utilizador (cacheado): resolve por email na tabela `usuario`; cria a
// linha (default PT) na 1.ª vez. Decide moeda/símbolo/fontes de preço (paisCfg). Sem
// email (test-auth sem email) → default. NUNCA deixa a auth falhar por causa disto.
const localeCache = new Map(); // email|id → { pais, locale, moeda, simbolo }
export async function resolveLocale(chave) {
  if (!chave) { const c = paisCfg(config.paisDefault); return { pais: config.paisDefault, locale: 'pt-BR', moeda: c.moeda, simbolo: c.simbolo }; }
  if (localeCache.has(chave)) return localeCache.get(chave);
  let pais = config.paisDefault, locale = 'pt-BR';
  try {
    const [[u]] = await getPool().query('SELECT pais, locale FROM usuario WHERE email = ?', [chave]);
    if (u) { pais = u.pais; locale = u.locale; }
    else if (chave.includes('@')) { await getPool().query('INSERT IGNORE INTO usuario (email, pais) VALUES (?, ?)', [chave, config.paisDefault]); }
  } catch { /* BD indisponível → default; não bloquear a auth */ }
  const c = paisCfg(pais);
  const out = { pais, locale, moeda: c.moeda, simbolo: c.simbolo };
  localeCache.set(chave, out);
  return out;
}
// Invalida o cache de locale de um utilizador (ao mudar o país via /api/me/pais).
export function invalidarLocale(chave) { if (chave) localeCache.delete(chave); }

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

export async function requireAuth(req, res, next) {
  // 1) o nosso JWT (login email+senha)
  const b = await checkBearer(req);
  if (b && b.email) {
    req.user = { id: b.email, email: b.email, nome: b.nome || null, via: 'local', ...(await resolveLocale(b.email)) };
    return next();
  }
  // 2) rede de segurança: test-auth (Basic) para os e2e
  if (config.auth.enableTestAuth) {
    const u = checkBasic(req);
    if (u) { req.user = { id: u, via: 'test-auth', ...(await resolveLocale(u.includes('@') ? u : null)) }; return next(); }
  }
  // SEM `WWW-Authenticate: Basic` — esse header faria o BROWSER abrir o diálogo nativo de
  // Basic Auth ao 1.º /api 401, tapando a UI de login da app. 401 limpo → a app mostra o login.
  return res.status(401).json({ erro: 'Autenticação necessária' });
}

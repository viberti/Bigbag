// Portão de autenticação. TEMPORÁRIO: enquanto o Google OAuth não está ativo,
// protege as rotas sensíveis (upload/consulta) com HTTP Basic + utilizadores de
// teste do .env (ENABLE_TEST_AUTH / TEST_USERS). A app está exposta à internet,
// por isso nenhuma rota que gaste a chave OpenRouter ou escreva na BD pode ficar
// anónima. Quando o OAuth entrar, este middleware passa a aceitar a sessão e o
// portão de teste é removido.
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function checkBasic(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  const user = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  const match = config.auth.testUsers.find((u) => safeEqual(u.u, user) && safeEqual(u.p, pass));
  return match ? match.u : null;
}

// Middleware: exige sessão autenticada. Hoje só o portão de teste; amanhã
// também a sessão OAuth (req.session?.user).
export function requireAuth(req, res, next) {
  // Futuro: if (req.session?.user) { req.user = req.session.user; return next(); }
  if (config.auth.enableTestAuth) {
    const u = checkBasic(req);
    if (u) {
      req.user = { id: u, via: 'test-auth' };
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Bigbag"');
  return res.status(401).json({ erro: 'Autenticação necessária' });
}

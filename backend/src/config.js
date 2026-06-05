// Carrega variáveis de ambiente do .env (não versionado) e expõe a configuração.
// Segredos vivem SÓ no .env — nunca hardcoded aqui.
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4200,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || 'app_bigbag',
    user: process.env.DB_USER || 'bigbag',
    password: process.env.DB_PASSWORD || '',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
    timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS) || 20000,
    // Voz: modelo de transcrição (trocável). Vazio = usa o modelo principal.
    sttModel: process.env.OPENROUTER_STT_MODEL || '',
  },
  auth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || '',
    superuserEmail: process.env.SUPERUSER_EMAIL || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    // Portão temporário (até o Google OAuth estar ativo). Ver auth.js.
    enableTestAuth: String(process.env.ENABLE_TEST_AUTH || '').toLowerCase() === 'true',
    testUsers: parseTestUsers(process.env.TEST_USERS),
  },
  uploads: {
    faturas: process.env.UPLOAD_DIR_FATURAS || './uploads/comprovantes',
    voz: process.env.UPLOAD_DIR_VOZ || './uploads/notas_voz',
  },
};

function parseTestUsers(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => x && x.u && x.p) : [];
  } catch {
    return [];
  }
}

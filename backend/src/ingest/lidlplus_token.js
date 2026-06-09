// Persistência do refresh token do Lidl Plus, que ROTACIONA a cada uso.
// Semente: LIDLPLUS_REFRESH_TOKEN (.env). Depois manda o ficheiro tokenFile
// (chmod 600), atualizado automaticamente a cada renovação. NÃO versionado.
import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../config.js';

const FILE = config.lidlplus.tokenFile;

export async function lerToken() {
  try {
    const t = (await readFile(FILE, 'utf8')).trim();
    if (t) return t;
  } catch { /* ainda não existe → usa a semente do .env */ }
  return config.lidlplus.refreshToken || '';
}

export async function guardarToken(token) {
  if (!token) return;
  try {
    await writeFile(FILE, token, { mode: 0o600 });
  } catch (e) {
    console.error('[lidlplus token] falha a guardar o refresh token:', e.message);
  }
}

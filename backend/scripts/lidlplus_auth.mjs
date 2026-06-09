// Autenticação do Lidl Plus SEM Selenium — fluxo Authorization Code + PKCE manual.
// Tu fazes login no teu BROWSER REAL (a password só toca na página do Lidl) e copias
// o `code` do redirect; este script troca-o por tokens e guarda o refresh token.
//
//   node scripts/lidlplus_auth.mjs
//
// Passos (o script guia-te):
//   1. Abre o URL impresso no teu browser, faz login (password + SMS).
//   2. No fim, o Lidl redireciona para com.lidlplus.app://callback?code=XXXX
//      (o browser não abre esse esquema → vê o URL na barra de endereço OU em
//       DevTools → Network com "Preserve log"). Copia o `code`.
//   3. Cola aqui o code (ou o URL inteiro do redirect).
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Buffer } from 'node:buffer';
import { config } from '../src/config.js';
import { guardarToken } from '../src/ingest/lidlplus_token.js';

const AUTH = 'https://accounts.lidl.com';
const CLIENT_ID = 'LidlPlusNativeClient';
const REDIRECT = 'com.lidlplus.app://callback';
const BASIC = Buffer.from(`${CLIENT_ID}:secret`).toString('base64');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const country = (config.lidlplus.country || 'PT').toUpperCase();
  const language = config.lidlplus.language || 'pt';

  // PKCE
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());

  const url = `${AUTH}/connect/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid profile offline_access lpprofile lpapis',
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    Country: country,
    language: `${language}-${country}`,
  });

  console.log('\n1) Abre este URL no teu browser e faz login (password + código SMS):\n');
  console.log(url + '\n');
  console.log('2) No fim, o Lidl tenta abrir  com.lidlplus.app://callback?code=XXXXXXXX');
  console.log('   O browser não abre esse esquema. Para ver o code:');
  console.log('   • Chrome/Edge: F12 → separador Network → "Preserve log" ANTES de entrar →');
  console.log('     procura o pedido para "callback?code=..." e copia o valor de code.');
  console.log('   • (ou copia o URL inteiro da barra de endereço, se ele aparecer)\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const resposta = (await rl.question('3) Cola aqui o code (ou o URL do redirect): ')).trim();
  rl.close();

  const code = (resposta.match(/code=([0-9A-Fa-f]+)/)?.[1]) || resposta.match(/^[0-9A-Fa-f]+$/)?.[0];
  if (!code) { console.error('Não encontrei um code válido no que colaste.'); process.exit(1); }

  console.log('\nA trocar o code por tokens…');
  const r = await fetch(`${AUTH}/connect/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${BASIC}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) {
    console.error('Falhou:', r.status, JSON.stringify(j));
    console.error('(o code expira depressa — repete o login e cola logo o code)');
    process.exit(1);
  }
  await guardarToken(j.refresh_token);
  console.log('\n✅ Autenticado. Refresh token guardado em', config.lidlplus.tokenFile);
  console.log('   (também o tens aqui, se quiseres pôr no .env):\n');
  console.log('LIDLPLUS_REFRESH_TOKEN=' + j.refresh_token + '\n');
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

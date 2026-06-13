// Captura screenshots das telas do app num viewport de telemóvel (Playwright).
// Ponto de partida reutilizável — ver docs/Processo_Documentar_App_para_Designer.md.
//
// Uso (numa pasta descartável, ex. tmp_ui/, gitignored):
//   npm i playwright && npx playwright install chromium
//   echo "user:pass" > .creds        # de TEST_USERS do .env do servidor; NUNCA versionar
//   node _capturar_telas.mjs         # PNGs em ./shots/ → mover as boas para docs/ui/
//
// Lições incorporadas:
//  - reload por tela (não fechar sheets): estado mais robusto que tentar navegar entre elas
//  - espera generosa antes do screenshot (telas com fetch lento mostram "..." senão)
//  - câmara/scanner: relançar com --use-fake-*-for-media-stream (ver bloco no fundo)
//  - selectores estáveis: classes (.kebab) e :has-text("…") (robusto a i18n parcial)
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const URL = 'https://bigbag.hal9klabs.com/';
const [user, pass] = readFileSync('.creds', 'utf8').trim().split(':');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 13'], // 390×844, DPR3 → PNG 1170×1992
  httpCredentials: { username: user, password: pass },
  permissions: ['camera'],
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const log = [];

async function clic(sel) {
  try { await page.click(sel, { timeout: 5000 }); await wait(1000); return true; }
  catch { console.error('  ✗ clique falhou:', sel); return false; }
}

// tela(nome, ...passos): volta ao início, refaz o caminho, tira screenshot.
// Um passo é um selector (string) ou uma função async que devolve ok/!ok.
async function tela(nome, ...passos) {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await wait(2200); // deixa o app hidratar + 1.º fetch
  for (const p of passos) {
    const ok = await (typeof p === 'string' ? clic(p) : p());
    if (!ok && typeof p === 'string') { console.error('  abortado:', nome); return; }
  }
  await wait(700); // telas com fetch lento (ex. despensa ~1.9s) → aumentar aqui
  await page.screenshot({ path: `shots/${nome}.png` });
  log.push(nome); console.error('  ✓', nome);
}

await tela('01_principal');
await tela('02_lista', '.listbtn');
await tela('03_despensa', '.despbtn');
await tela('04_menu', '.kebab');
await tela('05_gastos', '.kebab', 'button:has-text("gastos")');
await tela('06_conta', '.avatar');
await tela('07_perfil', '.avatar', 'button:has-text("erfil")');
await tela('08_comparar', 'button:has-text("Comparar")');
await tela('09_scanner', 'button:has-text("Scanner")');
await tela('11_ficha', '.despbtn', '.desp-crow'); // toca num produto → ficha

console.error('\nTELAS:', log.length, '→', log.join(', '));
await browser.close();

// --- Telas que precisam de CÂMARA falsa (scanner/scan) -----------------------
// Em headless não há câmara → a tela mostra erro. Relançar assim e repetir só
// as telas de scan:
//   const browser = await chromium.launch({ args: [
//     '--use-fake-device-for-media-stream',
//     '--use-fake-ui-for-media-stream',
//   ]});

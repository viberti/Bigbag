// ORQUESTRADOR — re-colhe todas as fontes VTEX do manifesto `fontes_vtex.json`, em série,
// com pausa entre fontes. Pensado para o CRON (mensal). Cada fonte corre num PROCESSO-FILHO
// isolado (`harvest_vtex.mjs`), por isso uma falha numa não derruba as outras; e o GUARD do
// harvest_vtex protege os dados existentes se um host vier a 0 (bloqueio/host mudou).
//
// Uso:
//   sudo -u dev node --env-file=.env scripts/refresh_fontes.mjs            # todas
//   sudo -u dev node --env-file=.env scripts/refresh_fontes.mjs --only=savegnago,zaffari
//   sudo -u dev node --env-file=.env scripts/refresh_fontes.mjs --pausa=60 # segundos entre fontes
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));            // .../backend/scripts
const backend = join(dir, '..');                                // .../backend
const manifesto = JSON.parse(readFileSync(join(dir, 'fontes_vtex.json'), 'utf8'));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const onlySet = arg('only') ? new Set(arg('only').split(',')) : null;
const pausaMs = Number(arg('pausa', 30)) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fontes = manifesto.filter((m) => !onlySet || onlySet.has(m.fonte));
console.log(`[refresh] ${fontes.length} fontes VTEX a re-colher (pausa ${pausaMs / 1000}s entre cada)…`);
const res = [];
for (let i = 0; i < fontes.length; i++) {
  const { fonte, host, cats } = fontes[i];
  console.log(`\n[refresh ${i + 1}/${fontes.length}] ${fonte} (${host})`);
  const args = ['--env-file=.env', 'scripts/harvest_vtex.mjs', host, fonte, ...(cats ? [`--cats=${cats}`] : [])];
  const r = spawnSync('/usr/bin/node', args, { cwd: backend, stdio: 'inherit' });
  res.push({ fonte, code: r.status });
  if (i < fontes.length - 1) await sleep(pausaMs);
}
console.log('\n[refresh] RESUMO:');
for (const r of res) console.log(`  ${r.code === 0 ? '✅' : `❌(${r.code})`} ${r.fonte}`);
const falhas = res.filter((r) => r.code !== 0).length;
console.log(`[refresh] ${res.length - falhas}/${res.length} ok${falhas ? ` (${falhas} falhas)` : ''}.`);
process.exit(0);

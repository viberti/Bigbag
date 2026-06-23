// Orquestra a colheita PERIÓDICA de TODAS as farmácias (fontes_farmacia.json) pela engine
// certa (campo `motor`). Para o CRON. Regras (dono): UPSERT em TODAS — NUNCA apaga a base
// para recolher de novo; produtos que saem da loja ficam; campos enriquecidos preservados;
// EANs novos entram; preços atualizam; cada MUDANÇA de preço vai ao histórico append-only
// (catalogo_preco_hist). Sequencial + pausa entre fontes (gentil com os hosts).
//
//   node scripts/refresh_farmacias.mjs [--only=a,b] [--pausa=segundos] [--no-fundo] [--max=N]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const M = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8'));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const only = (arg('only', '') || '').split(',').filter(Boolean);
const pausa = Number(arg('pausa', '8')) || 8;
const fundo = !process.argv.includes('--no-fundo'); // VTEX em modo profundo (passa o teto 2500)
const maxJ = arg('max', '8000');
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

let ok = 0, falhas = 0;
for (const f of M) {
  if (only.length && !only.includes(f.fonte)) continue;
  const motor = f.motor || 'vtex';
  let args;
  if (motor === 'raiadrogasil') {
    args = ['--env-file=.env', 'scripts/harvest_raiadrogasil.mjs', `--host=${f.host}`, `--fonte=${f.fonte}`, '--atualizar'];
  } else if (motor === 'panvel') {
    args = ['--env-file=.env', 'scripts/harvest_panvel.mjs', '--atualizar', `--limite=${maxJ}`];
  } else if (motor === 'nissei') {
    args = ['--env-file=.env', 'scripts/harvest_nissei.mjs', '--atualizar', `--limite=${maxJ}`];
  } else if (motor === 'araujo') {
    args = ['--env-file=.env', 'scripts/harvest_araujo.mjs', '--atualizar', `--limite=${maxJ}`];
  } else if (motor === 'jsonld') {
    args = ['--env-file=.env', 'scripts/harvest_jsonld.mjs', f.host, f.fonte, `--max=${maxJ}`, ...(f.geo ? ['--proxy'] : [])];
  } else { // vtex (default)
    args = ['--env-file=.env', 'scripts/harvest_vtex.mjs', f.host, f.fonte, `--cats=${f.cats}`, ...(fundo ? ['--fundo'] : []), ...(f.geo ? ['--proxy'] : [])];
  }
  console.log(`\n===== ${f.fonte} (${motor}${f.geo ? ' · proxy' : ''}) ${ts()} =====`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' }); // process.execPath = mesmo node (cron tem PATH mínimo)
  if (r.status === 0) ok++; else { falhas++; console.log(`⚠️ ${f.fonte} saiu com código ${r.status}`); }
  spawnSync('sleep', [String(pausa)]);
}
// limiares de FRETE GRÁTIS publicados (homepages) → fretes_gratis.json
console.log(`\n===== frete grátis (homepages) ${ts()} =====`);
spawnSync(process.execPath, ['scripts/fretes_gratis.mjs'], { stdio: 'inherit' });
console.log(`\n===== refresh_farmacias CONCLUÍDO ${ts()} · ${ok} ok · ${falhas} falhas =====`);

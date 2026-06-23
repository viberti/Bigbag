// Descobre o limiar de FRETE GRÁTIS publicado na HOMEPAGE de cada farmácia
// ("Frete Grátis acima de R$X") — o valor EXATO e barato (1 fetch por farmácia).
// Escreve scripts/fretes_gratis.json (cache lido pela rota /precos-ao-vivo). Best-effort:
// as que não anunciam na home ficam de fora (a rota cai na estimativa por simulação).
// Corre no cron (dentro do refresh_farmacias). Geo → via proxy.
import { readFileSync, writeFileSync } from 'node:fs';
import { aplicarProxy } from '../src/rede.js';

const M = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8'));
const H = { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', accept: 'text/html' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "frete grátis ... R$ 169,90" (até ~55 caracteres entre os dois)
const RE = /frete\s*gr[aá]tis[^<>]{0,55}?R\$\s?(\d{1,3}(?:\.\d{3})*(?:[.,]\d{2})?)/i;
const proxied = process.argv.includes('--proxy');
if (proxied) aplicarProxy();

const out = {};
for (const f of M) {
  if (!f.host) continue;
  try {
    const r = await fetch(`https://${f.host}/`, { ...H, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    const txt = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
    const m = txt.match(RE);
    if (m) {
      const v = Number(m[1].replace(/\.(?=\d{3})/g, '').replace(',', '.'));
      if (v >= 20 && v <= 1000) out[f.fonte] = { acima: v, texto: m[0].replace(/\s+/g, ' ').trim().slice(0, 60) };
    }
  } catch { /* sem home / bloqueada → fica de fora */ }
  await sleep(250);
}
writeFileSync(new URL('./fretes_gratis.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`✅ frete grátis publicado: ${Object.keys(out).length} farmácias · ${Object.entries(out).map(([k, v]) => `${k} R$${v.acima}`).join(' · ')}`);

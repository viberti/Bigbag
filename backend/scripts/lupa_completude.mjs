// LUPA — completude (STEP A+B), read-only. Para os EANs GLP-1 da grade × todas as VTEX de
// fontes_farmacia.json: busca AO VIVO o PRODUTO COMPLETO por EAN (mesmo caminho de produção,
// EAN-âncora) e compara com o banco → classifica OK / FALTA-POR-LATÊNCIA / DIVERGE / NÃO-VENDE.
// Confirma a âncora (productName) p/ distinguir LATÊNCIA de BUG-de-adaptador. NÃO escreve nada.
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { aplicarProxy } from '../src/rede.js';
import { precoValido } from '../src/normaliza/precoValido.js';
aplicarProxy();
import { ProxyAgent } from 'undici';
const _disp = process.env.PROXY_URL ? new ProxyAgent(process.env.PROXY_URL) : undefined;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const H = { 'user-agent': 'Mozilla/5.0 Chrome/124', accept: 'application/json' };

const pool = getPool();
const FONTES = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8')).filter((f) => (f.motor || 'vtex') === 'vtex');
const [grade] = await pool.query("SELECT DISTINCT m.ean, m.produto FROM medicamento m JOIN catalogo_produto cp ON cp.ean=m.ean AND cp.preco>0 WHERE m.produto IN('OZEMPIC','MOUNJARO') ORDER BY m.produto, m.ean");

async function vtexProd(host, ean, geo) {
  try {
    const r = await fetch(`https://${host}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`, { headers: H, signal: AbortSignal.timeout(9000), dispatcher: geo ? _disp : undefined });
    const j = await r.json();
    const p = j && j[0]; const it = p && p.items && p.items[0]; const co = it && it.sellers && it.sellers[0] && it.sellers[0].commertialOffer;
    if (!it) return { existe: false };
    const qtd = num(co && co.AvailableQuantity);
    const disponivel = !((qtd != null && qtd <= 0) || (co && co.IsAvailable === false));
    const precoRaw = num(co && co.Price);
    return { existe: true, nome: p.productName, eanItem: it.ean, qtd, disponivel, precoRaw, preco: precoValido(precoRaw, { disponivel }) ? precoRaw : null };
  } catch (e) { return { _erro: e.message.slice(0, 24) }; }
}

const falta = []; // FALTA-POR-LATÊNCIA p/ o STEP C
console.log('ean'.padEnd(14) + 'fonte'.padEnd(17) + 'classe'.padEnd(20) + 'aovivo'.padEnd(26) + 'banco');
for (const g of grade) {
  for (const f of FONTES) {
    const live = await vtexProd(f.host, g.ean, !!f.geo);
    await new Promise((r) => setTimeout(r, 180));
    const [[b]] = await pool.query('SELECT preco, scraped_at, TIMESTAMPDIFF(HOUR,scraped_at,NOW()) idade FROM catalogo_produto WHERE ean=? AND fonte=?', [g.ean, f.fonte]);
    const temBanco = b && b.preco != null;
    let cls;
    if (live._erro) cls = 'ERRO-LIVE';
    else if (live.existe && live.disponivel && live.preco != null) {
      if (!temBanco) { cls = 'FALTA-POR-LATÊNCIA'; falta.push({ ean: g.ean, fonte: f.fonte, host: f.host, geo: !!f.geo, live }); }
      else { const dif = Math.abs(live.preco - Number(b.preco)) / Number(b.preco); cls = dif < 0.02 ? 'OK' : 'DIVERGE(preço)'; }
    } else if (!live.existe) cls = temBanco ? 'banco-tem/live-não(stale?)' : 'NÃO-VENDE';
    else cls = temBanco ? 'OK(esgotado)' : 'esgotado/sem-banco';
    if (cls === 'OK' || cls === 'NÃO-VENDE') continue; // só mostra o que interessa
    const av = live.existe ? `R$${live.preco ?? 'null'}${live.disponivel ? '' : '/esg'}(q${live.qtd})` : (live._erro ? 'erro' : 'não-vende');
    const bk = temBanco ? `R$${b.preco} (${b.idade}h)` : (b ? 'preco=NULL' : 'sem-linha');
    console.log(g.ean.padEnd(14) + f.fonte.padEnd(17) + cls.padEnd(20) + av.padEnd(26) + bk);
  }
}

// STEP A — veredito explícito para drogariamoderna (âncora confirma produto certo?)
console.log('\n══ VEREDITO drogariamoderna (latência vs bug) ══');
for (const g of grade.filter((x) => x.produto === 'MOUNJARO')) {
  const f = FONTES.find((x) => x.fonte === 'drogariamoderna');
  const live = await vtexProd(f.host, g.ean, false);
  await new Promise((r) => setTimeout(r, 180));
  const [[b]] = await pool.query("SELECT preco FROM catalogo_produto WHERE ean=? AND fonte='drogariamoderna'", [g.ean]);
  const ancoraOk = live.existe && (String(live.eanItem) === g.ean);
  let ver = '—';
  if (live.existe && live.disponivel && live.preco != null && (!b || b.preco == null)) ver = ancoraOk ? 'LATÊNCIA (vende+disp, âncora OK, banco vazio)' : 'BUG? (âncora EAN!=)';
  else if (live.existe && live.preco == null) ver = 'esgotado/sentinela (guard OK)';
  else if (!live.existe) ver = 'NÃO-VENDE (live não tem)';
  else ver = 'OK (já no banco)';
  console.log(`  ${g.ean}  ${ver}  · live="${(live.nome || '').slice(0, 34)}" eanItem=${live.eanItem || '-'} preco=${live.preco ?? '-'} q=${live.qtd ?? '-'}`);
}

console.log(`\n>>> FALTA-POR-LATÊNCIA total: ${falta.length} (ean×fonte) <<<`);
console.log(falta.map((x) => `${x.fonte}:${x.ean}`).join(', '));
await closePool();

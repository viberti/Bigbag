// Re-harvest DIRIGIDO por EAN numa fonte VTEX — mesmo caminho de produção (API de catálogo
// VTEX por EAN) + mesmo UPSERT de catalogo_produto + catalogo_preco_hist do harvest_vtex,
// COM o guard precoValido do Cluster 1 ATIVO. Para sanar latência (item voltou ao estoque,
// ainda não no banco). Dirigido: só os EANs passados, só a fonte passada.
//   sudo -u dev node --env-file=.env scripts/reharvest_dirigido_vtex.mjs --fonte=drogariamoderna --host=www.drogariamoderna.com.br --eans=a,b,c [--executar]
import { getPool, closePool } from '../src/db.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';
import { tituloProduto } from '../src/normaliza/titulo.js';
import { precoValido } from '../src/normaliza/precoValido.js';
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const fonte = arg('fonte'), host = arg('host'), EXEC = process.argv.includes('--executar');
const eans = (arg('eans', '') || '').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
const H = { 'user-agent': 'Mozilla/5.0 Chrome/124', accept: 'application/json' };
if (!fonte || !host || !eans.length) { console.error('faltam --fonte/--host/--eans'); process.exit(1); }
console.log(`[reharvest dirigido] fonte=${fonte} host=${host} eans=${eans.length} guard=precoValido(ATIVO) ${EXEC ? 'EXECUTAR' : 'DRY-RUN'}`);

const pool = getPool();
const upserts = [], hist = [];
for (const ean of eans) {
  let p, it, co;
  try {
    const r = await fetch(`https://${host}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`, { headers: H, signal: AbortSignal.timeout(9000) });
    const j = await r.json(); p = j && j[0]; it = p && p.items && p.items[0]; co = it && it.sellers && it.sellers[0] && it.sellers[0].commertialOffer;
  } catch (e) { console.log(`  ${ean} ERRO ${e.message.slice(0, 30)}`); continue; }
  if (!it || !co) { console.log(`  ${ean} sem item/oferta (não vende) — skip`); continue; }
  if (String(it.ean) !== ean) { console.log(`  ${ean} ⚠ âncora EAN!=${it.ean} — skip (não casar errado)`); continue; }
  const qtd = num(co.AvailableQuantity);
  const disponivel = !((qtd != null && qtd <= 0) || co.IsAvailable === false);
  const preco = precoValido(num(co.Price), { disponivel }) ? num(co.Price) : null; // GUARD Cluster 1
  if (preco == null) { console.log(`  ${ean} sem preço válido (esgotado/sentinela) — guard descartou, skip`); continue; }
  const sku = String(it.itemId || p.productId).slice(0, 24);
  const nome = tituloProduto(String(p.productName || '').slice(0, 255));
  const marca = p.brand ? tituloProduto(String(p.brand).slice(0, 140)) : null;
  const path = (p.categories || [])[0] || '';
  const nv = path.split('/').filter(Boolean).map((s) => tituloProduto(s));
  const fmt = extrairFormato(nome);
  const ppb = fmt ? precoPorBase({ preco_liquido: preco, quantidade: 1 }, fmt) : null;
  const url = (p.link || `https://${host}`).slice(0, 600);
  const img = (it.images && it.images[0] && it.images[0].imageUrl) ? String(it.images[0].imageUrl).slice(0, 600) : null;
  console.log(`  ${ean} OK → "${nome.slice(0, 36)}" sku=${sku} R$${preco} q=${qtd}`);
  upserts.push([fonte, sku, ean, nome, marca, path ? path.replace(/^\/|\/$/g, '') : null, nv[nv.length - 1] || null, nv[0] || null, nv[1] || null, nv[2] || null, nv[3] || null,
    fmt ? (`${fmt.formato_valor ?? ''}${fmt.unidade_base ?? ''}`.trim() || null) : null, fmt?.unidade_base || null, fmt?.formato_valor ?? null, preco, 'BRL', ppb, url, img]);
  hist.push([fonte, sku, ean, preco, 'BRL', ppb]);
  await new Promise((r) => setTimeout(r, 300));
}

if (!EXEC) { console.log(`\n(DRY-RUN — ${upserts.length} prontos. Re-corra com --executar.)`); await closePool(); process.exit(0); }
let novas = 0, atualizadas = 0;
for (const v of upserts) {
  const [[ja]] = await pool.query('SELECT preco FROM catalogo_produto WHERE fonte=? AND sku_fonte=?', [v[0], v[1]]);
  const [res] = await pool.query(
    `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, categoria_path, categoria, cat_n1, cat_n2, cat_n3, cat_n4, formato, unidade_base, formato_valor, preco, moeda, preco_por_base, url, imagem_url, scraped_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), preco=VALUES(preco), moeda=VALUES(moeda), preco_por_base=VALUES(preco_por_base), url=VALUES(url), imagem_url=VALUES(imagem_url), scraped_at=NOW()`, v);
  if (!ja) novas++; else atualizadas++;
  console.log(`  UPSERT ${v[0]}:${v[2]} → ${ja ? 'ATUALIZADA' : 'NOVA'} (R$${v[14]})`);
}
for (const h of hist) await pool.query('INSERT INTO catalogo_preco_hist (fonte, sku_fonte, ean, preco, moeda, preco_por_base, visto_em) VALUES (?,?,?,?,?,?,NOW())', h);
console.log(`\n✅ UPSERT: ${novas} novas + ${atualizadas} atualizadas · ${hist.length} linhas no histórico`);
await closePool();

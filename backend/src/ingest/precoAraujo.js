// Preço de uma farmácia ARAÚJO (araujo.com.br) por EAN. Grande rede mineira (MG). Não-VTEX,
// mas SERVER-RENDERED e limpa: a busca `/busca?q=<EAN>` devolve os produtos (com link da PDP
// `/<slug>/<id>.html`) e a PDP traz um bloco **schema.org Product/Drug VÁLIDO** com
// `gtin13`+`offers.price`. Fluxo: busca por EAN → 1.º link → PDP → gtin (confirma o EAN) +
// preço. 2 requests/EAN. Partilhado por harvester + monitor.
const HOST = 'www.araujo.com.br';
const H = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', accept: 'text/html,application/xhtml+xml,*/*', 'accept-language': 'pt-BR,pt;q=0.9' };
import { precoValido } from '../normaliza/precoValido.js';
const getHtml = async (url, timeout = 14000) => { const r = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(timeout) }); return { status: r.status, txt: r.status === 200 ? await r.text() : '' }; };

// 1.º bloco JSON-LD cujo @type inclui Product ou Drug.
function jsonldProduto(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (const o of arr) { const ty = [].concat(o['@type'] || ''); if (ty.some((t) => /Product|Drug/i.test(t))) return o; }
    } catch { /* bloco inválido — ignora */ }
  }
  return null;
}

// { existe, preco, nome, marca, sku, gtin, url, imagem }. `null` = não respondeu;
// { existe:false } = a Araújo não tem o EAN (ou o 1.º resultado não confirma o gtin).
export async function precoAraujoEan(ean, { timeout = 14000 } = {}) {
  const alvo = String(ean).replace(/\D/g, '');
  let s;
  try { s = await getHtml(`https://${HOST}/busca?q=${alvo}`, timeout); } catch { return null; }
  if (s.status !== 200) return s.status >= 500 ? null : { existe: false };
  const link = [...s.txt.matchAll(/href="(\/[a-z0-9][a-z0-9-]{8,}\/\d+\.html)"/gi)].map((m) => m[1])[0];
  if (!link) return { existe: false };
  let p;
  try { p = await getHtml(`https://${HOST}${link}`, timeout); } catch { return null; }
  if (p.status !== 200) return null;
  const ld = jsonldProduto(p.txt);
  if (!ld) return { existe: false };
  const gtin = String(ld.gtin13 || ld.gtin || ld.gtin14 || '').replace(/\D/g, '');
  if (!gtin || !(gtin === alvo || gtin.endsWith(alvo) || alvo.endsWith(gtin.replace(/^0+/, '')))) return { existe: false };
  const of = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  const precoLd = of ? Number(of.price) : null;                                // o JSON-LD traz o PBM (mais baixo)
  const dec = Number((p.txt.match(/"decimalPrice":"([0-9.]+)"/) || [])[1]);    // preço NORMAL (sales, SFCC)
  const regular = Number.isFinite(dec) && dec > 0 ? dec : precoLd;
  // condicional = o PBM/desconto do laboratório, SE for mesmo mais baixo que o normal.
  let precoCond = null, precoCondObs = null;
  if (Number.isFinite(precoLd) && precoLd > 0 && Number.isFinite(regular) && precoLd < regular - 0.001) {
    precoCond = precoLd; precoCondObs = 'Desconto do laboratório (PBM) · pode exigir CPF';
  }
  // sku = o id do produto no URL (/<slug>/<id>.html) — único. O `ld.sku` da Araújo às vezes
  // é um OBJETO (vira "[object Object]" e colidiria na chave (fonte, sku_fonte)) → não usar.
  const idUrl = (link.match(/\/(\d+)\.html/) || [])[1];
  const skuLd = (typeof ld.sku === 'string' || typeof ld.sku === 'number') ? String(ld.sku) : null;
  const marcaTxt = typeof ld.brand === 'string' ? ld.brand : (ld.brand && typeof ld.brand.name === 'string' ? ld.brand.name : null);
  return {
    existe: true,
    preco: precoValido(regular) ? regular : null,
    preco_cond: precoCond, preco_cond_obs: precoCondObs,
    nome: typeof ld.name === 'string' ? ld.name : null, marca: marcaTxt,
    sku: String(idUrl || skuLd || alvo).slice(0, 24), gtin,
    imagem: (ld.image && (Array.isArray(ld.image) ? ld.image[0] : ld.image)) || null,
    url: `https://${HOST}${link}`,
  };
}

// Preço de uma farmácia NISSEI (farmaciasnissei.com.br) por EAN. #6 do varejo farma BR
// (PR/SC). Next.js: a busca `/pesquisa/<termo>` é server-rendered (devolve os cartões de
// produto, com o SLUG da PDP), mas o PREÇO ali é hidratado por JS ("0,00" no HTML). A PDP
// é que traz, server-rendered, um bloco schema.org Product com `gtin` + `price` (JSON
// inválido, extraído por regex). Logo: busca por EAN → slug → PDP → gtin (confirma o EAN) +
// preço. 2 requests/EAN. NÃO resolve desafios. Partilhado por harvester + monitor.
const HOST = 'www.farmaciasnissei.com.br';
const H = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', accept: 'text/html,application/xhtml+xml,*/*', 'accept-language': 'pt-BR,pt;q=0.9' };
const NAV = /^\/(?:pesquisa|categoria|categorias|marca|marcas|institucional|conta|carrinho|club|farmacia-|blog|sitemap|politica|favoritos|pedido)/i;

const getHtml = async (url, timeout = 14000) => { const r = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(timeout) }); return { status: r.status, txt: r.status === 200 ? await r.text() : '' }; };
const campo = (html, k, num = false) => { const m = html.match(new RegExp(`"${k}"\\s*:\\s*"?(${num ? '[0-9]+\\.[0-9]{2}' : '[^"]{2,120}'})`, 'i')); return m ? m[1] : null; };

// Devolve { existe, preco, nome, marca, sku, gtin, url, imagem }. `null` = não respondeu;
// { existe:false } = a Nissei não tem este EAN (ou o 1.º resultado não confirma o gtin).
export async function precoNisseiEan(ean, { timeout = 14000 } = {}) {
  const alvo = String(ean).replace(/\D/g, '');
  let s;
  try { s = await getHtml(`https://${HOST}/pesquisa/${alvo}`, timeout); } catch { return null; }
  if (s.status !== 200) return s.status >= 500 ? null : { existe: false };
  // 1.º cartão de produto: primeiro href que é um slug de produto (segmento único, longo).
  const slug = [...s.txt.matchAll(/href="(\/[a-z0-9][a-z0-9-]{12,})"/gi)].map((m) => m[1]).find((u) => !NAV.test(u) && !u.includes('/'.repeat(2)) && (u.match(/\//g) || []).length === 1);
  if (!slug) return { existe: false };
  let p;
  try { p = await getHtml(`https://${HOST}${slug}`, timeout); } catch { return null; }
  if (p.status !== 200) return null;
  const gtin = (campo(p.txt, 'gtin') || '').replace(/\D/g, '');
  // confirma que a PDP é MESMO o EAN procurado (o gtin vem em GTIN-14 com 0 à frente).
  if (!gtin || !(gtin === alvo || gtin.endsWith(alvo) || alvo.endsWith(gtin.replace(/^0+/, '')))) return { existe: false };
  const preco = Number(campo(p.txt, 'price', true));
  return {
    existe: true,
    preco: Number.isFinite(preco) && preco > 0 ? preco : null,
    nome: campo(p.txt, 'name'), marca: (p.txt.match(/"brand"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i) || [])[1] || null,
    sku: String(campo(p.txt, 'sku') || alvo).slice(0, 24), gtin,
    imagem: (campo(p.txt, 'image') || null), url: `https://${HOST}${slug}`,
  };
}

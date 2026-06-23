// Preço de uma farmácia PANVEL por EAN, pela API pública do BFF (Angular SSR). Usa a v2
// (POST /api/v2/search) que NÃO exige cookies de WAF (a v3 exige Azion). Headers genéricos
// (sem sessão real). Busca por código de barras → exigimos match EXATO (totalItems===1).
// Partilhado pelo harvester (harvest_panvel.mjs) e pelo monitor (monitorarPrecos.js).
const UF_DEFAULT = process.env.PANVEL_UF || '03';
const PH = {
  accept: 'application/json, text/plain, */*', 'app-token': 'ZYkPuDaVJEiD', 'client-ip': '1',
  'content-type': 'application/json', 'search-new': 'A', source: 'mobile', 'user-id': '0',
  sessionid: '00000000-0000-4000-8000-000000000000', origin: 'https://www.panvel.com',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
};

// Devolve { existe, preco, nome, marca, sku, imagem, url }. `null` = não respondeu (não
// confundir com "não tem"); { existe:false } = a Panvel não carrega este EAN.
export async function precoPanvelEan(ean, { uf = UF_DEFAULT, timeout = 12000 } = {}) {
  let r;
  try {
    r = await fetch(`https://www.panvel.com/api/v2/search?type=CSR&uf=${uf}`, {
      method: 'POST', headers: PH, signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ term: String(ean), itemsPerPage: 5, currentPage: 1, assortment: 'mais relevantes', filters: [], searchOffers: false, searchType: 'term' }),
    });
  } catch { return null; }
  if (r.status !== 200) return null;
  let j; try { j = await r.json(); } catch { return null; }
  if (!j || j.totalItems !== 1 || !Array.isArray(j.items) || !j.items[0]) return { existe: false };
  const it = j.items[0];
  const preco = Number(it.discount && it.discount.dealPrice != null ? it.discount.dealPrice : it.originalPrice);
  // condicional: o PBM (it.pbm.priceList) — preço de programa do laboratório, SE for mais
  // baixo. O labelMessage diz a condição (ex.: "1ª Compra"). Decodifica entidades HTML simples.
  let precoCond = null, precoCondObs = null;
  const pl = it.pbm && Array.isArray(it.pbm.priceList) ? it.pbm.priceList.filter((x) => x && x.dealPrice > 0).sort((a, b) => a.dealPrice - b.dealPrice)[0] : null;
  if (pl && Number.isFinite(preco) && pl.dealPrice < preco - 0.001) {
    precoCond = Number(pl.dealPrice);
    const lbl = String(pl.labelMessage || '').replace(/&ordf;/gi, 'ª').replace(/&ordm;/gi, 'º').replace(/&[a-z]+;/gi, '').trim();
    precoCondObs = 'Desconto do laboratório (PBM)' + (lbl ? ` · ${lbl}` : '');
  }
  return {
    existe: true,
    preco: Number.isFinite(preco) && preco > 0 ? preco : null,
    preco_cond: precoCond, preco_cond_obs: precoCondObs,
    nome: it.name || null, marca: it.brandName || null,
    sku: String(it.panvelCode || ean).slice(0, 24),
    imagem: it.image ? String(it.image).split('?')[0] : null,
    url: it.link || null,
  };
}

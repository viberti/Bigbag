// Preço + FRETE ao vivo de uma farmácia VTEX, por EAN + CEP. Duas chamadas: busca por
// EAN (SKU + preço atual) e simulação de checkout (frete para o CEP). Separa ENTREGA de
// RETIRADA-em-loja e deteta "não entrega neste CEP" (o VTEX devolve um frete-sentinela
// alto / prazo enorme). Para fontes geo-bloqueadas (DPSP), roteia por um ProxyAgent
// POR PEDIDO (não mexe no dispatcher global da app).
import { ProxyAgent } from 'undici';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, accept: 'application/json' };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const ehRetira = (s) => /retir|retire|pickup|retira/i.test(s.name || '') || !!(s.pickupStoreInfo && s.pickupStoreInfo.isPickupStore);

let _disp; // ProxyAgent cacheado (fontes geo)
function proxyDispatcher() {
  if (_disp !== undefined) return _disp;
  const u = process.env.PROXY_URL;
  try { _disp = u ? new ProxyAgent(u) : null; } catch { _disp = null; }
  return _disp;
}

export async function precoVivoVtex(host, ean, cep, { timeout = 4500, proxy = false } = {}) {
  const dispatcher = proxy ? proxyDispatcher() : undefined;
  let it;
  try {
    const r = await fetch(`https://${host}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`, { headers: H, signal: AbortSignal.timeout(timeout), dispatcher });
    const j = await r.json();
    it = j && j[0] && j[0].items && j[0].items[0];
  } catch { return null; } // fonte não respondeu a tempo → mantém-se a cache
  if (!it) return { existe: false };
  const sku = String(it.itemId || '');
  const seller = (it.sellers && it.sellers[0] && it.sellers[0].sellerId) || '1';
  const preco = num(it.sellers && it.sellers[0] && it.sellers[0].commertialOffer && it.sellers[0].commertialOffer.Price);

  let frete = null, prazo = null, entrega = false, retira = false;
  try {
    const sr = await fetch(`https://${host}/api/checkout/pub/orderForms/simulation?sc=1`, {
      method: 'POST', headers: { ...H, 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeout), dispatcher,
      body: JSON.stringify({ items: [{ id: sku, quantity: 1, seller }], postalCode: cep, country: 'BRA' }),
    });
    const sim = await sr.json();
    const slas = (sim && sim.logisticsInfo && sim.logisticsInfo[0] && sim.logisticsInfo[0].slas) || [];
    retira = slas.some(ehRetira);
    const ent = slas.filter((s) => !ehRetira(s))
      .map((s) => ({ frete: num(s.price) != null ? num(s.price) / 100 : null, prazo: s.shippingEstimate || null }))
      .filter((s) => s.frete != null && s.frete < 500) // > R$500 = sentinela "não entrega"
      .sort((a, b) => a.frete - b.frete);
    if (ent.length) { frete = ent[0].frete; prazo = ent[0].prazo; entrega = true; }
  } catch { /* sem frete (mostra só o preço) */ }

  return { existe: true, sku, preco, frete, prazo, entrega, retira, total: preco != null && frete != null ? Math.round((preco + frete) * 100) / 100 : null };
}

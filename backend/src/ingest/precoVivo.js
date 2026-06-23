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

// Simula o checkout p/ uma quantidade e devolve a opção de ENTREGA mais barata (ignora
// retirada). { frete, prazo, retira } — frete null se não houver entrega a este CEP.
async function simular(host, sku, seller, qty, cep, dispatcher, timeout) {
  try {
    const sr = await fetch(`https://${host}/api/checkout/pub/orderForms/simulation?sc=1`, {
      method: 'POST', headers: { ...H, 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeout), dispatcher,
      body: JSON.stringify({ items: [{ id: sku, quantity: qty, seller }], postalCode: cep, country: 'BRA' }),
    });
    const sim = await sr.json();
    const slas = (sim && sim.logisticsInfo && sim.logisticsInfo[0] && sim.logisticsInfo[0].slas) || [];
    const retira = slas.some(ehRetira);
    const ent = slas.filter((s) => !ehRetira(s))
      .map((s) => ({ frete: num(s.price) != null ? num(s.price) / 100 : null, prazo: s.shippingEstimate || null }))
      .filter((s) => s.frete != null && s.frete < 500) // > R$500 = sentinela "não entrega"
      .sort((a, b) => a.frete - b.frete);
    return ent.length ? { frete: ent[0].frete, prazo: ent[0].prazo, retira } : { frete: null, prazo: null, retira };
  } catch { return { frete: null, prazo: null, retira: false }; }
}

// Preço + ESTOQUE de uma farmácia VTEX por EAN, SEM frete (não precisa de CEP nem simulação)
// — usado pelo monitor periódico. Devolve { existe, preco, disponivel, qtd }. `existe:false`
// = a farmácia não carrega o produto; `null` = não respondeu (não registar como esgotado).
export async function precoEstoqueVtex(host, ean, { timeout = 9000, proxy = false } = {}) {
  const dispatcher = proxy ? proxyDispatcher() : undefined;
  let it;
  try {
    const r = await fetch(`https://${host}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`, { headers: H, signal: AbortSignal.timeout(timeout), dispatcher });
    const j = await r.json();
    it = j && j[0] && j[0].items && j[0].items[0];
  } catch { return null; }
  if (!it) return { existe: false };
  const offer = (it.sellers && it.sellers[0] && it.sellers[0].commertialOffer) || null;
  const precoRaw = num(offer && offer.Price);
  const preco = precoRaw != null && precoRaw > 0 && precoRaw < 1e6 ? precoRaw : null;
  const qtd = num(offer && offer.AvailableQuantity);
  const disponivel = preco != null && !((qtd != null && qtd <= 0) || (offer && offer.IsAvailable === false));
  return { existe: true, preco, disponivel, qtd };
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
  const offer = (it.sellers && it.sellers[0] && it.sellers[0].commertialOffer) || null;
  const precoRaw = num(offer && offer.Price);
  // 0 ou valor-sentinela (ex.: 9999999 = "indisponível" no VTEX) → sem preço real.
  const preco = precoRaw != null && precoRaw > 0 && precoRaw < 1e6 ? precoRaw : null;
  if (preco == null) return { existe: false }; // não tem oferta real → fica a cache
  // ESTOQUE: o VTEX expõe AvailableQuantity (0 = esgotado) e IsAvailable. Sem estoque, não
  // adianta indicar a farmácia (preço que não dá para comprar) → trata como sem oferta.
  const disp = num(offer.AvailableQuantity);
  if ((disp != null && disp <= 0) || offer.IsAvailable === false) return { existe: false };

  // Em PARALELO: frete deste 1 item + frete de um carrinho MAIOR (~R$250) p/ detetar
  // "frete grátis acima de um valor" (política comum). qty limitada (stock).
  const qtyAlto = preco && preco > 0 ? Math.min(40, Math.max(2, Math.ceil(250 / preco))) : 10;
  const [s1, sAlto] = await Promise.all([
    simular(host, sku, seller, 1, cep, dispatcher, timeout),
    simular(host, sku, seller, qtyAlto, cep, dispatcher, timeout),
  ]);
  const subAlto = preco != null ? Math.round(preco * qtyAlto) : null;
  // frete grátis em pedido maior = a opção de entrega cai a ~0 num carrinho grande.
  const freteGratisMaiores = sAlto.frete != null && sAlto.frete < 0.5;

  return {
    existe: true, sku, preco,
    frete: s1.frete, prazo: s1.prazo, entrega: s1.frete != null, retira: s1.retira || sAlto.retira,
    total: preco != null && s1.frete != null ? Math.round((preco + s1.frete) * 100) / 100 : null,
    frete_gratis_maiores: freteGratisMaiores, frete_gratis_sub: freteGratisMaiores ? subAlto : null,
  };
}

// Cliente da API (não-oficial) do Lidl Plus — faturas digitais COM EAN por linha.
// Portado dos endpoints REST que a lib `lidl-plus` (Python) usa. Só precisamos do
// REFRESH TOKEN (segredo no .env); o login inicial (browser+password+OTP) faz-se à
// parte com a ferramenta `lidl-plus` e NUNCA toca aqui.
//
// Fluxo: refreshToken → POST /connect/token (Basic do client nativo) → access token
// → GET tickets (lista paginada) e GET tickets/{id} (detalhe com as linhas).
//
// ⚠ ESQUELETO: o mapeamento do detalhe do talão (ticketParaFatura) tem nomes de
// campos a CONFIRMAR contra um talão real (ver TODOs). Usar primeiro o CLI
// scripts/lidlplus_importar.mjs --ticket <id> para ver o JSON cru.
import { Buffer } from 'node:buffer';
import { config } from '../config.js';
import { eanValido } from './produto.js';

const AUTH = 'https://accounts.lidl.com';
const TICKETS = 'https://tickets.lidlplus.com/api/v2';
const CLIENT_ID = 'LidlPlusNativeClient';
const BASIC = Buffer.from(`${CLIENT_ID}:secret`).toString('base64'); // client secret nativo (igual ao app)

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
// Preços do Lidl podem vir como "1,29" / "1.29" / número. Normaliza para € (float).
const euro = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Renova o access token a partir do refresh token. Devolve { token, refreshToken,
// expiresAt }. O Lidl ROTACIONA o refresh token → o chamador deve guardar o novo.
export async function renovarToken(refreshToken) {
  const r = await fetch(`${AUTH}/connect/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${BASIC}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  if (!r.ok) throw new Error(`Lidl auth falhou: HTTP ${r.status} (refresh token inválido/expirado?)`);
  const j = await r.json();
  return {
    token: j.access_token,
    refreshToken: j.refresh_token || refreshToken,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
}

// Cria um cliente com renovação automática do access token. country/language do config.
export function criarCliente({ refreshToken = config.lidlplus.refreshToken, country = config.lidlplus.country, language = config.lidlplus.language } = {}) {
  if (!refreshToken) throw new Error('Falta LIDLPLUS_REFRESH_TOKEN no .env');
  let sess = null;
  const C = country.toUpperCase();

  async function token() {
    if (!sess || Date.now() >= sess.expiresAt - 30_000) sess = await renovarToken(sess?.refreshToken || refreshToken);
    return sess.token;
  }
  async function get(url) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${await token()}`,
        'App-Version': '999.99.9',
        'Operating-System': 'iOs',
        App: 'com.lidl.eci.lidl.plus',
        'Accept-Language': language,
      },
    });
    if (!r.ok) throw new Error(`Lidl API ${r.status} em ${url}`);
    return r.json();
  }

  return {
    // refresh token (possivelmente rotacionado) — guardar no .env se mudar.
    get refreshTokenAtual() { return sess?.refreshToken || refreshToken; },
    // Lista TODOS os talões (pagina até ao fim).
    async listarTickets() {
      const url = (p) => `${TICKETS}/${C}/tickets?pageNumber=${p}&onlyFavorite=false`;
      const p1 = await get(url(1));
      let tickets = p1.tickets || [];
      const totalPaginas = Math.ceil((p1.totalCount || 0) / (p1.size || 1));
      for (let p = 2; p <= totalPaginas; p++) tickets = tickets.concat((await get(url(p))).tickets || []);
      return tickets;
    },
    // Detalhe completo de um talão (as linhas com EAN).
    obterTicket(id) { return get(`${TICKETS}/${C}/tickets/${id}`); },
  };
}

// ⚠ Mapeia o JSON de UM talão → formato `dados` que o persist espera.
// NOMES DE CAMPOS A CONFIRMAR contra um talão real (campos do `lidl-plus`:
// itens com name/quantity/isWeight/currentUnitPrice/originalAmount/codeInput=EAN).
export function ticketParaFatura(ticket) {
  const linhas = ticket.itemsLine || ticket.items || ticket.articles || ticket.lineItems || [];
  const itens = linhas.map((it) => {
    const eanRaw = String(it.codeInput || it.ean || it.barCode || '').replace(/\D/g, '');
    const ean = eanRaw && eanValido(eanRaw) ? eanRaw : null;
    const aPeso = !!(it.isWeight || it.weight);
    const qtd = num(it.quantity) ?? 1;
    return {
      descricao_original: String(it.name || it.description || '').slice(0, 200),
      ean, // ← o prémio: EAN por linha
      linha_peso: aPeso ? String(it.quantity || '') : null, // TODO: formato real do peso
      quantidade: aPeso ? 1 : qtd, // a peso → qtd=1 (o "peso" é a quantidade)
      preco_unitario: euro(it.currentUnitPrice ?? it.unitPrice),
      preco_liquido: euro(it.originalAmount ?? it.totalAmount ?? it.amount ?? it.extendedAmount),
      preco_por_base: null, // calculado a jusante (formato/ppb)
      taxa_iva: num(it.taxGroup) ?? null,
      is_clearance: 0,
      desconto_direto: 0,
      is_non_product: 0,
    };
  });
  return {
    loja: { cadeia: 'Lidl', nome: ticket.storeName || 'Lidl', nif: ticket.fiscalDataNif || null, localizacao: ticket.storeAddress || null },
    data_compra: ticket.date || ticket.datetime || ticket.purchaseDate || null, // TODO confirmar
    numero_fatura: ticket.id || ticket.sequenceNumber || ticket.ticketNumber || null,
    total_impresso: euro(ticket.totalAmount ?? ticket.total),
    iva: 0,
    desconto_global: euro(ticket.totalDiscount) || 0,
    itens,
    origem_captura: 'lidlplus',
  };
}

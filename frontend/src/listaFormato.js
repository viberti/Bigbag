// Apresentação da LISTA DE COMPRAS — partilhada pela v2 (AppV2) e pela app "Lista" (/lista).
// Funções PURAS (sem React): secções, preço por item, quantidades. Extraídas do AppV2 em
// 2026-10-16 sem mudar comportamento (fonte única; mudar aqui muda nas duas apps).

// Moeda corrente (camada locale): cada app define-a no load da sessão (/api/me → moeda).
let MOEDA = 'EUR';
export const setMoeda = (m) => { if (m) MOEDA = m; };
export const fmtPreco = (v, moeda = MOEDA) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const s = Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moeda === 'BRL' ? `R$ ${s}` : `${s} €`;
};
const eur = (v) => fmtPreco(v);

// grupo (lente de loja) → rótulo de secção cartoon
export const SEC_LABEL = { frutas: 'Frutas e vegetais', carne: 'Talho e charcutaria', peixe: 'Peixe e marisco',
  lacticinios: 'Laticínios e ovos', padaria: 'Padaria', congelados: 'Congelados', bebidas: 'Bebidas',
  doces: 'Doces e snacks', mercearia: 'Mercearia', higiene: 'Higiene e limpeza', outros: 'Outros' };
export const secDe = (it) => SEC_LABEL[it.grupo] || 'Outros';
export const SEC_ORDER = ['Frutas e vegetais', 'Talho e charcutaria', 'Peixe e marisco', 'Padaria', 'Laticínios e ovos', 'Congelados', 'Mercearia', 'Bebidas', 'Doces e snacks', 'Higiene e limpeza', 'Outros'];
export const ordSec = (s) => { const i = SEC_ORDER.indexOf(s); return i < 0 ? 99 : i; };

// agrupa itens por secção, ordenando por SEC_ORDER (cada cabeçalho aparece 1×)
export function agruparSec(itens) {
  const ord = [...itens].sort((a, b) => ordSec(secDe(a)) - ordSec(secDe(b)));
  const grupos = []; let last = null;
  ord.forEach((it) => { const s = secDe(it); if (!last || last.s !== s) { last = { s, itens: [] }; grupos.push(last); } last.itens.push(it); });
  return grupos;
}

// Os 3 botões da barra ADICIONAM à lista (não consultam): voz (ditado→lote),
// escrever (nome direto, qualquer produto — não exige ficha nutricional), e
// código (scan→adiciona). Antes voz/texto caíam na CONSULTA e falhavam p/ não-alimentos.
// Subtítulo de preço de um item da lista. CORRIGIDO (2026-06-15): a v2 lia
// it.preco_estimado/it.preco (campos que o backend NUNCA define) → mostrava sempre
// "sem preço". O backend dá preco_mercado/melhor_preco (FACTO, €/base) e preco_ref
// (referência de catálogo). Mesma cadeia da v1.
// Rótulo legível de um peso/volume: qtd_medida vem sempre na unidade-base (kg/L); o display
// escolhe g/kg (ou ml/L) pela grandeza: <1 kg → "200 g", senão "1,2 kg".
export function fmtMedida(qtd, unidade) {
  const n = Number(qtd) || 0;
  const v = (x) => String(x).replace('.', ',');
  if (unidade === 'kg') return n < 1 ? `${Math.round(n * 1000)} g` : `${v(Math.round(n * 1000) / 1000)} kg`;
  if (unidade === 'L') return n < 1 ? `${Math.round(n * 1000)} ml` : `${v(Math.round(n * 1000) / 1000)} L`;
  return `${v(n)} ${unidade || ''}`.trim();
}

// Formata um TAMANHO em texto para exibição, AGNÓSTICO à unidade de entrada (canónico "1000 g"/
// "250 ml", legado "0,25 kg"/"25 cl", ou já amigo "1 kg"): normaliza a peso(g)/volume(ml) e aplica
// ≥1000 g → kg, ≥1000 ml → L (dono). Idempotente.
export function fmtTamanho(s) {
  if (!s) return s;
  const m = String(s).match(/^(\d+(?:[.,]\d+)?)\s*(kg|mg|gr|g|lt|l|dl|cl|ml|cc|un)$/i);
  if (!m) return s;
  const val = parseFloat(m[1].replace(',', '.')); const u = m[2].toLowerCase();
  const n = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000)).replace('.', ',');
  let g = null, ml = null;
  if (u === 'kg') g = val * 1000; else if (u === 'g' || u === 'gr') g = val; else if (u === 'mg') g = val / 1000;
  else if (u === 'l' || u === 'lt') ml = val * 1000; else if (u === 'dl') ml = val * 100; else if (u === 'cl') ml = val * 10; else if (u === 'ml' || u === 'cc') ml = val;
  else return `${Math.round(val)} un`;
  if (g != null) return g >= 1000 ? `${n(g / 1000)} kg` : `${n(g)} g`;
  return ml >= 1000 ? `${n(ml / 1000)} L` : `${n(ml)} ml`;
}

// Ovos contam-se por DÚZIA (convenção; produto popular — enriquecimento especial permitido). 1 pack = 1 dúzia.
// Exclui o que não é ovo-de-galinha à dúzia (chocolate/líquido/pó/codorniz/páscoa).
export function ehOvoDuzia(nome) {
  const n = String(nome || '').toLowerCase();
  return /\bovos?\b/.test(n) && !/l[íi]quido|chocolate|p[áa]scoa|kinder|surpresa|\bp[óo]\b|codorn/.test(n);
}

export function precoLista(it) {
  // OVOS → preço por DÚZIA (o pack é a dúzia): mostra o preço pago/de mercado por pack, rotulado /dúzia.
  if (ehOvoDuzia(it.nome)) { const p = it.preco_pago ?? it.melhor_preco ?? it.preco_mercado; return p != null ? `${eur(p)}/dúzia` : 'sem preço'; }
  // €/base (€/kg) SÓ para itens vendidos a PESO (it.unidade = modo peso). Tudo o resto — EAN, embalado, OU
  // um kg-genérico em PACOTE FIXO (rúcula "EMB.100GR") — mostra o PREÇO DO PACOTE pago (facto do talão),
  // nunca €/kg. O €/kg de um pacote de 100 g ("9,9/kg") era enganador; o utilizador compra o pacote.
  if (!it.unidade && it.preco_pago != null) return eur(it.preco_pago);
  const p = it.preco_mercado ?? it.melhor_preco;
  if (p != null) return `${eur(p)}${it.unidade_base ? `/${it.unidade_base}` : ''}`;
  if (it.preco_ref != null) return `~${eur(it.preco_ref)}`;
  return 'sem preço';
}

// Quantidade legível de um item: peso (g/kg), dúzias de ovos, ou unidades.
export function qtdTxt(it) {
  if (it.unidade) return fmtMedida(it.qtd_medida, it.unidade);
  const q = it.quantidade || 1;
  if (ehOvoDuzia(it.nome)) return `${q} dúzia${q > 1 ? 's' : ''}`;
  return `${q} un`;
}

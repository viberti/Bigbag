// Helpers de EXIBIÇÃO de produto — os MESMOS da v1 (App.jsx), copiados verbatim
// para a v2 reutilizar SEM tocar na v1 (marca limpa/capitalizada, tamanho/formato,
// agregação de linhas iguais do talão). Se mudar, mudar nos dois (ou, mais tarde,
// a v1 importa daqui = fonte única).
const MARCAS_HOLDING = new Set(['sonae', 'jerónimo martins', 'jeronimo martins', 'auchan holding', 'schwarz']);
// 1.ª letra de cada palavra maiúscula, resto minúscula ("PINGO DOCE" → "Pingo Doce").
export const capMarca = (s) =>
  String(s || '').toLowerCase().replace(/(^|[\s\-/&.])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
export const limparMarca = (s) => {
  const partes = String(s || '').split(/[,/;]/).map((x) => x.trim()).filter(Boolean);
  const reais = partes.filter((p) => !MARCAS_HOLDING.has(p.toLowerCase()));
  return capMarca((reais[0] || partes[0] || '').trim());
};
// nome do talão: se vier TODO em maiúsculas (item não identificado, ex.: "PEITO
// FAMILIAR"), capitaliza; se já tiver minúsculas (nome canónico tratado), deixa.
export const nomeTalao = (s) => (/[a-zà-ÿ]/.test(String(s || '')) ? String(s || '') : capMarca(s));

function tamanhoTexto(s) {
  const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*(cl|ml|lt|litros?|kg|gr|g|l)\b/i);
  if (!m) return null;
  const u = m[2].toLowerCase().replace(/^lt$/, 'l').replace(/^litros?$/, 'l').replace(/^gr$/, 'g');
  return `${m[1].replace('.', ',')} ${u}`;
}
const CONTENTORES = [
  { re: /\blatas?\b/i, label: 'lata' },
  { re: /\b(garrafas?|grf|gf)\b/i, label: 'garrafa' },
  { re: /\btp\b/i, label: 'garrafa' },
  { re: /\bbarril\b/i, label: 'barril' },
];
export function formatoProduto(it) {
  const desc = String(it.descricao_raw || '');
  let tam = tamanhoTexto(it.tamanho) || tamanhoTexto(desc);
  let cont = null;
  for (const c of CONTENTORES) if (c.re.test(desc)) { cont = c.label; break; }
  if (!tam && cont) { const b = desc.match(/\b(\d{2,3})\b/); if (b) tam = `${b[1]} cl`; } // bebida: nº ≈ cl
  return [tam, cont].filter(Boolean).join(' · ') || null;
}
// agrega linhas IGUAIS do talão (mesmo nome+marca+EAN+preço unitário) somando qtd/total
export function agregarItensTalao(itens) {
  if (!Array.isArray(itens)) return [];
  const mapa = new Map(); const out = [];
  for (const it of itens) {
    const qtd = Number(it.quantidade) || 1;
    const linha = Number(it.preco) || 0;
    const unit = qtd ? linha / qtd : linha;
    const key = [it.produto, it.ean || '', limparMarca(it.marca) || '', Math.round(unit * 100)].join('|');
    const ex = mapa.get(key);
    if (ex) { ex.quantidade += qtd; ex.preco += linha; }
    else { mapa.set(key, { ...it, quantidade: qtd, preco: linha }); out.push(mapa.get(key)); }
  }
  return out;
}

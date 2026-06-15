// ÁRVORE DE FAMÍLIAS — vocabulário CURADO (nosso, não do OFF/loja), em código (como os
// outros vocabulários fechados: SECCOES_LISTA, TIPOS_NOME). É o nível "família" do fusor
// de categoria (docs/Classificacao_Fusor.md): o nó onde o PREÇO se compara e as
// ALTERNATIVAS se cruzam. 1.º ramo: MERCEARIA ALIMENTAR (o que mais doía).
//
// Cada família guarda os roll-ups (as LENTES como projeções, não sistemas paralelos):
//   dep = departamento (food/non_food) · grupo = corredor · seccao = secção da lista ·
//   unidade = unidade-base do preço · natureza = a lente de NATUREZA quando difere do
//   corredor (anchova: corredor=mercearia/conservas MAS natureza=peixe → alergénio).
import { norm, TIPOS_NOME } from './categoria.js';

export const FAMILIAS = {
  massa:              { label: 'Massa',                     dep: 'food', grupo: 'mercearia', seccao: 'mercearia',    unidade: 'kg' },
  arroz:              { label: 'Arroz',                     dep: 'food', grupo: 'mercearia', seccao: 'mercearia',    unidade: 'kg' },
  cereais_pa:         { label: 'Cereais',                   dep: 'food', grupo: 'mercearia', seccao: 'mercearia',    unidade: 'kg' },
  leguminosas:        { label: 'Leguminosas',               dep: 'food', grupo: 'mercearia', seccao: 'mercearia',    unidade: 'kg' },
  conservas_peixe:    { label: 'Conservas de Peixe',        dep: 'food', grupo: 'mercearia', seccao: 'mercearia',    unidade: 'kg', natureza: 'peixe' },
  conservas_vegetais: { label: 'Conservas Vegetais',        dep: 'food', grupo: 'mercearia', seccao: 'mercearia',    unidade: 'kg' },
  molhos_condimentos: { label: 'Molhos e Condimentos',      dep: 'food', grupo: 'mercearia', seccao: 'condimentos',  unidade: 'un' },
  azeite_oleo:        { label: 'Azeite e Óleo',             dep: 'food', grupo: 'mercearia', seccao: 'condimentos',  unidade: 'l'  },
  especiarias:        { label: 'Especiarias e Temperos',    dep: 'food', grupo: 'mercearia', seccao: 'condimentos',  unidade: 'kg' },
  farinha_acucar:     { label: 'Farinhas, Açúcar e Fermentos', dep: 'food', grupo: 'mercearia', seccao: 'mercearia', unidade: 'kg' },
  cafe_cha:           { label: 'Café, Chá e Infusões',       dep: 'food', grupo: 'mercearia', seccao: 'cafe_cha',    unidade: 'kg' },
};

export const familia = (slug) => FAMILIAS[slug] || null;

// Reusa as regexes de massa/cereais já provadas em TIPOS_NOME (zero drift com o golden).
const T = Object.fromEntries(TIPOS_NOME);

// Classificador determinístico NOME → família (sobre norm(): minúsculas, sem acentos).
// Ordem = específico → geral (o 1.º que casa vence). Só faz sentido DENTRO da mercearia
// alimentar; o fusor aplica-o nesse contexto (não a bebidas/frescos com os mesmos tokens).
const FAM_RE = [
  ['conservas_peixe',    /(^|[^a-z])(atum|sardinhas?|anchovas?|anchoa|cavala|\bsarda\b|biqueir[ao]|melva|filetes? de (peixe|cavala|sarda|anchova))/],
  ['cafe_cha',           T.cafe_cha],
  ['azeite_oleo',        /(^|[^a-z])(azeite|olive oil|oleo (de )?(girassol|alimentar|vegetal|amendoim|colza|milho)|\boleo\b)/],
  ['molhos_condimentos', /(^|[^a-z])(ketchup|maionese|mayon|mostarda|mustard|\bmolho|\bsauce\b|pesto|vinagrete?|sofrito|aioli|alioli|barbecue|teriyaki|worcester|tabasco|guacamole|\bbechamel)/],
  ['especiarias',        /(^|[^a-z])(\bsal\b|pimenta|oregaos?|oregano|canela|\bcaril\b|\bcurry\b|cominho|colorau|paprica|noz[- ]moscada|\blouro\b|\bcravo\b|acafrao|gengibre em po|tomilho|alecrim|especiaria|\btempero)/],
  ['massa',              T.massa],
  ['arroz',              /(^|[^a-z])(arroz|basmati|risotto|risoto|arborio|carolino|\bagulha\b|jasmim)/],
  ['cereais_pa',         T.cereais],
  ['leguminosas',        /(^|[^a-z])(feij[ao]|feijoes|\bgrao\b|grao de bico|garbanzo|lentilhas?|\bervilhas?\b|\bfavas?\b)/],
  ['conservas_vegetais', /(^|[^a-z])(milho doce|\bmilho\b|tomate (pelado|triturado|frito)|polpa de tomate|passatas?|pelati|concentrado de tomate|cogumelos?|champignon|pimentos? (piquillo|morron|assados)|piquillo|palmito|alcachofra|espargos|azeitonas?|\bpickles?\b|\bpicles\b|em calda|em vinagre|cebolinhas?)/],
  ['farinha_acucar',     /(^|[^a-z])(farinha|\bacucar\b|azucar|fermento (em po|de padeiro|quimico)|levedura|gelatina (neutra|em po)|maizena|amido de milho|\bfecula)/],
];

// Marcas que SÃO de massa (fabricantes) → massa, mesmo com nome estranho (caso tipoConsumidor).
const MARCA_MASSA = /(^|[^a-z])(pasta|massa)([^a-z]|$)/;

export function familiaPorNome(nome, marca = null) {
  const s = norm(nome);
  if (!s) return null;
  for (const [slug, re] of FAM_RE) if (re.test(s)) return slug;
  if (marca && MARCA_MASSA.test(norm(marca))) return 'massa';
  return null;
}

// TODAS as famílias que um texto casa (não pára na 1.ª). Para a PONTE categoria→família:
// uma string de categoria que casa 2+ famílias é COMPOSTA ("Arroz e Massa") → ambígua →
// vai ao resíduo (LLM/fusor decide), em vez de ser mapeada errado pela 1.ª que calha.
export function familiasQueCasam(texto) {
  const s = norm(texto);
  if (!s) return [];
  const out = [];
  for (const [slug, re] of FAM_RE) if (re.test(s)) out.push(slug);
  return [...new Set(out)];
}

// FUSOR de FAMÍLIA: funde os sinais e devolve { familia, via, votos } (proveniência).
// Pesos por fiabilidade: VLM-tipo (viu o pacote) > categoria-loja/OFF (1 família = limpa;
// compostas abstêm-se) > nome+marca. Puro: a categoria entra como TEXTO (familiasQueCasam);
// a versão persistida/LLM da ponte é a tabela categoria_ancora. RESOLVE O HOMÓNIMO — o
// caso Pérolas: nome→null, mas "Massas secas"/"massa alimentícia" dão massa.
export function familiaDe({ nome = '', marca = null, categoria = '', tipoTexto = '' } = {}) {
  const votos = [];
  const vt = familiaPorNome(tipoTexto, marca);
  if (vt) votos.push({ familia: vt, via: 'vlm-tipo', peso: 3 });
  const fc = familiasQueCasam(categoria);
  if (fc.length === 1) votos.push({ familia: fc[0], via: 'categoria', peso: 2 });
  const fn = familiaPorNome(nome, marca);
  if (fn) votos.push({ familia: fn, via: 'nome', peso: 2 });
  if (!votos.length) return { familia: null, via: null, votos: [] };
  const soma = {};
  for (const v of votos) soma[v.familia] = (soma[v.familia] || 0) + v.peso;
  const win = Object.entries(soma).sort((a, b) => b[1] - a[1])[0][0];
  return { familia: win, via: votos.find((v) => v.familia === win).via, votos };
}

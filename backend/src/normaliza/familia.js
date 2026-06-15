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
};

export const familia = (slug) => FAMILIAS[slug] || null;

// Reusa as regexes de massa/cereais já provadas em TIPOS_NOME (zero drift com o golden).
const T = Object.fromEntries(TIPOS_NOME);

// Classificador determinístico NOME → família (sobre norm(): minúsculas, sem acentos).
// Ordem = específico → geral (o 1.º que casa vence). Só faz sentido DENTRO da mercearia
// alimentar; o fusor aplica-o nesse contexto (não a bebidas/frescos com os mesmos tokens).
const FAM_RE = [
  ['conservas_peixe',    /(^|[^a-z])(atum|sardinhas?|anchovas?|anchoa|cavala|\bsarda\b|biqueir[ao]|melva|filetes? de (peixe|cavala|sarda|anchova))/],
  ['azeite_oleo',        /(^|[^a-z])(azeite|olive oil|oleo (de )?(girassol|alimentar|vegetal|amendoim|colza|milho)|\boleo\b)/],
  ['molhos_condimentos', /(^|[^a-z])(ketchup|maionese|mayon|mostarda|mustard|\bmolho|\bsauce\b|pesto|vinagrete?|sofrito|aioli|alioli|barbecue|teriyaki|worcester|tabasco|guacamole|\bbechamel)/],
  ['especiarias',        /(^|[^a-z])(\bsal\b|pimenta|oregaos?|oregano|canela|\bcaril\b|\bcurry\b|cominho|colorau|paprica|noz[- ]moscada|\blouro\b|\bcravo\b|acafrao|gengibre em po|tomilho|alecrim|especiaria|\btempero)/],
  ['massa',              T.massa],
  ['arroz',              /(^|[^a-z])(arroz|basmati|risotto|risoto|arborio|carolino|\bagulha\b|jasmim)/],
  ['cereais_pa',         T.cereais],
  ['leguminosas',        /(^|[^a-z])(feij[ao]|feijoes|\bgrao\b|grao de bico|garbanzo|lentilhas?|\bervilhas?\b|\bfavas?\b)/],
  ['conservas_vegetais', /(^|[^a-z])(milho doce|\bmilho\b|tomate (pelado|triturado|frito)|polpa de tomate|passatas?|pelati|concentrado de tomate|cogumelos?|champignon|pimentos? (piquillo|morron|assados)|piquillo|palmito|alcachofra|espargos)/],
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

// B1 (Analise_Fontes, Fase B) — categoria com VOCABULÁRIO FECHADO: o "grupo" de
// alto nível do SKU (11 valores), calculado deterministicamente. Move para a base
// o que o frontend remendava por keywords (categoriaAlto em App.jsx) — os ids são
// OS MESMOS para a UI usar o grupo do servidor diretamente. A `categoria` texto
// livre mantém-se como detalhe; o grupo é o eixo estável para agrupar/filtrar.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export const GRUPOS = [
  { id: 'frutas', t: ['fruta', 'fruit', 'legume', 'vegetal', 'vegetable', 'verdura', 'hortic', 'hortofrut', 'salada', 'cogumelo', 'meloa', 'melao', 'melancia', 'salsa'] },
  { id: 'carne', t: ['carne', 'meat', 'charcutaria', 'fiambre', 'ham', 'enchido', 'salsicha', 'sausage', 'salam', 'talho', 'aves', 'poultry', 'bovino', 'beef', 'suino', 'pork', 'porco', 'frango', 'chicken', 'peru', 'presunto', 'chourico'] },
  { id: 'peixe', t: ['peixe', 'fish', 'marisco', 'seafood', 'bacalhau', 'atum', 'tuna', 'salmao', 'salmon', 'pescado', 'sardinha', 'cavala', 'biqueir'] },
  { id: 'lacticinios', t: ['laticinio', 'lacteo', 'lacte', 'dair', 'leite', 'milk', 'queijo', 'cheese', 'iogurte', 'yogurt', 'yoghurt', 'manteiga', 'butter', 'nata', 'ovo', 'ovos', 'egg', 'eggs', 'requeijao', 'kefir', 'skyr', 'burrata', 'mozzarella'] },
  { id: 'padaria', t: ['cereai', 'cereal', 'breakfast', 'pao', 'bread', 'padaria', 'bakery', 'pastelaria', 'massa', 'pasta', 'arroz', 'rice', 'farinha', 'flour', 'tosta', 'wrap', 'croissant', 'muesli', 'granola', 'aveia'] },
  { id: 'bebidas', t: ['bebida', 'beverage', 'drink', 'agua', 'water', 'sumo', 'juice', 'refrigerante', 'soda', 'cerveja', 'beer', 'vinho', 'wine', 'cafe', 'coffee', 'cha', 'tea', 'alcool', 'alcohol'] },
  { id: 'doces', t: ['chocolate', 'doce', 'sweet', 'guloseima', 'candy', 'gelado', 'ice cream', 'snack', 'bolacha', 'biscuit', 'biscoito', 'cookie', 'sobremesa', 'dessert', 'mel', 'honey', 'compota', 'marmelada', 'jam'] },
  { id: 'congelados', t: ['congelado', 'frozen', 'ultracongelado'] },
  { id: 'higiene', t: ['higiene', 'hygiene', 'limpeza', 'cleaning', 'nao alimentar', 'detergente', 'detergent', 'papel', 'paper', 'cosmetic', 'sabonete', 'champo', 'beleza', 'lixivia', 'amaciador'] },
  { id: 'mercearia', t: ['mercearia', 'grocery', 'conserva', 'azeite', 'olive oil', 'oleo', 'oil', 'molho', 'sauce', 'tempero', 'especiaria', 'spice', 'enlatado', 'canned', 'sal', 'salt', 'acucar', 'sugar', 'leguminosa', 'feijao', 'grao'] },
];
export const GRUPO_OUTROS = 'outros';
export const GRUPOS_IDS = [...GRUPOS.map((g) => g.id), GRUPO_OUTROS];

// food_groups do OFF (tags en:) → grupo. Cobertura direta quando há ficha OFF.
const FOOD_GROUPS = {
  'fruits-and-vegetables': 'frutas', 'fruits': 'frutas', 'vegetables': 'frutas',
  'meat': 'carne', 'meat-other-than-poultry': 'carne', 'poultry': 'carne', 'processed-meat': 'carne',
  'fish-and-seafood': 'peixe', 'fish-meat-eggs': 'carne',
  'milk-and-dairy-products': 'lacticinios', 'dairy-desserts': 'lacticinios', 'cheese': 'lacticinios', 'eggs': 'lacticinios',
  'cereals-and-potatoes': 'padaria', 'bread': 'padaria', 'breakfast-cereals': 'padaria', 'cereals': 'padaria',
  'beverages': 'bebidas', 'alcoholic-beverages': 'bebidas', 'unsweetened-beverages': 'bebidas', 'sweetened-beverages': 'bebidas',
  'sugary-snacks': 'doces', 'salty-snacks': 'doces', 'sweets': 'doces', 'biscuits-and-cakes': 'doces', 'ice-cream': 'doces',
  'fats-and-sauces': 'mercearia', 'dressings-and-sauces': 'mercearia', 'fats': 'mercearia', 'canned-foods': 'mercearia',
};

// Match por INÍCIO de palavra, não substring ("VERMELHA" continha "mel" → Doces;
// "CHAMPO" continha "cha" → Bebidas). Termos curtos (≤3) exigem palavra inteira.
const _re = new Map();
function termRe(term) {
  let re = _re.get(term);
  if (!re) { re = new RegExp(`(^|[^a-z0-9])${term}${term.length <= 3 ? '(?![a-z0-9])' : ''}`); _re.set(term, re); }
  return re;
}

export function grupoDeTexto(texto) {
  const s = norm(texto);
  if (!s) return GRUPO_OUTROS;
  for (const g of GRUPOS) if (g.t.some((term) => termRe(term).test(s))) return g.id;
  return GRUPO_OUTROS;
}

// Reduz um token (já normalizado: minúsculas, sem acentos) ao SINGULAR canónico.
// Cobre as classes do português que aparecem em produtos: -ões/-ães→-ão (limões→
// limão, pães→pão), -éis/-veis→-el (pastéis→pastel, saudáveis→saudável), -ais/-óis
// →-al/-ol (integrais→integral), -ns→-m (bombons→bombom), -res/-zes/-ses→raiz
// (flores→flor, arrozes→arroz, ananases→ananás) e o -s simples (uvas→uva).
// NÃO precisa de ser linguisticamente perfeita: é aplicada AOS DOIS lados da
// comparação, por isso basta ser CONSISTENTE — um erro de redução só estraga se
// duas palavras DIFERENTES colidirem no mesmo singular (ex. teórico: mães/mãos→
// "mao" — irrelevante em nomes de produto). Mínimos de comprimento protegem os
// tokens curtos ("pais", "mais", "gas" ficam intactos).
export function singularizar(t) {
  if (t.length < 4) return t;
  if (t.endsWith('oes') || t.endsWith('aes')) return t.slice(0, -3) + 'ao'; // limões, pães
  if (t.endsWith('eis') && t.length >= 5) return t.slice(0, -3) + 'el';     // pastéis, saudáveis
  if (t.endsWith('ais') && t.length >= 5) return t.slice(0, -2) + 'l';      // integrais, naturais
  if (t.endsWith('ois') && t.length >= 5) return t.slice(0, -2) + 'l';      // espanhóis
  if (t.endsWith('ns')) return t.slice(0, -2) + 'm';                        // bombons
  if (/[rz]es$/.test(t) && t.length >= 5) return t.slice(0, -2);            // flores, arrozes
  if (t.endsWith('ses') && t.length >= 5) return t.slice(0, -2);            // ananases
  // -is fica intacto: "pais"/"mais"/"lápis" são invariantes (os plurais -éis/-ais/
  // -óis longos já foram tratados acima); -ss idem ("expresso" não tem plural aqui).
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('is')) return t.slice(0, -1); // uvas, iogurtes
  return t;
}

// Um token do PEDIDO casa um token do NOME quando: são iguais; são o MESMO
// singular (plural⇄singular nos dois sentidos, incluindo irregulares — pão/pães,
// limão/limões — via singularizar, NÃO por prefixo: prefixo largo foi o que fez
// "sal" casar "salmão"); ou o nome é a raiz de um pedido mais longo (nome ≥4,
// p/ abreviaturas tipo "BOL"→"bolachas" ao contrário).
// Partilhado pelos matchers por token (lista, consulta, ficha) para não divergirem.
export function tokenCasa(nomeTok, pedidoTok) {
  if (nomeTok === pedidoTok) return true;
  if (singularizar(nomeTok) === singularizar(pedidoTok)) return true;
  if (pedidoTok.startsWith(nomeTok) && nomeTok.length >= 4) return true;
  return false;
}

// Grupo de um SKU a partir das fontes disponíveis, por força decrescente:
// food_groups do OFF (autoritativo) → NOME → categoria (texto). O nome do produto
// é mais fiável que a categoria de LOJA, que mistura prateleiras: "Charcutaria e
// Queijos" casava 'charcutaria'→carne ANTES de 'queijo'→lacticínios, e punha os
// queijos na carne. O nome ("Queijo Grana Padano") desambigua; a categoria é a rede.
export function grupoDe({ foodGroups = null, categoria = null, nome = null } = {}) {
  for (const fg of Array.isArray(foodGroups) ? foodGroups : []) {
    const slug = String(fg).replace(/^en:/, '');
    if (FOOD_GROUPS[slug]) return FOOD_GROUPS[slug];
  }
  const porNome = grupoDeTexto(nome);
  if (porNome !== GRUPO_OUTROS) return porNome;
  return grupoDeTexto(categoria);
}

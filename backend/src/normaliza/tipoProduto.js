// Classificação determinística ALIMENTO vs NÃO-ALIMENTO (Fase 1, sem LLM).
// Devolve 'food' | 'non_food' | null (ambíguo → fase 2 com LLM, ou tratamento neutro).
//
// Princípio (regra GERAL, não caso-a-caso): padrões por CATEGORIA de produto
// (detergentes, higiene, especiarias…), nunca por SKU individual.
//
// O input é DES-ACENTUADO antes de casar (o \b do JS não funciona junto a acentos:
// "água"/"champô" falhariam) → as regexes abaixo são ASCII.
//
// Ordem dos sinais (mais fiável → menos):
//  1. nutrição/food_groups presentes → ALIMENTO (definitivo: só alimento os tem).
//  2. padrões CLAROS de não-alimento no NOME (fiáveis mesmo com categoria errada —
//     ex.: "Leite de Proteção Solar" vem mal-tagueado como Laticínios no catálogo).
//  3. categoria de loja/OFF de não-alimento.
//  4. nome de alimento-sem-nutrição (água/vinho/especiarias) → ALIMENTO.
//  5. categoria de alimento.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// nomes de PRODUTOS não-alimentícios (limpeza, higiene, beleza, casa, papelaria…)
const NON_FOOD_NOME = /\bdeterg|lixivia|amaciador|\bsabonete|\bsabao\b|gel de banho|champo\b|shampoo|condicionador (de cabelo|capilar)|desodoriz|antitranspirante|pasta de dentes|dentifric|escova de dentes|cotonete|toalhit|papel higi|papel de cozinha|rolo de cozinha|guardanapo|lencos? de papel|\bfralda|penso higi|\btampoes|absorvent|\bpilhas?\b|\bbaterias?\b|sacos? (do |de )?lixo|pelicula|papel de aluminio|papel vegetal|papel de forno|filtros?( de)? cafe|esfregao|\besponja|vassoura|\bbalde\b|\bluvas\b|fosforos?|isqueiro|inseticida|repelente|protetor solar|protecao solar|after sun|creme (solar|de rosto|facial|de maos|corporal|hidratante|anti|de noite|de dia)|maquilha|maquiagem|\bbatom\b|\bverniz|perfume|colonia|locao corporal|limpa.?vidros|lava.?louca|lava.?roupa|\bvelas?\b|sacos? de congela/;
// categorias de LOJA/OFF de não-alimento
const NON_FOOD_CAT = /beleza|higien|cabelo|capilar|\blimpeza|deterg|\bcorpo\b|desodoriz|\broupa|papelaria|\bpapel\b|\bgato\b|\bcao\b|\banimal|animais|petfood|\bcasa\b|drogaria|cosmetic|perfum|maquilha|dentifric|\bdental|\bfralda|farmacia|jardim|bricolage|brinquedo|textil/;
// alimentos SEM nutrição típica (devem ser 'food', não "não alimentício")
const FOOD_NOME = /\bagua\b|\bvinho|espumante|cerveja|\blicor|whisky|\brum\b|\bgin\b|\bvodka|moscatel|aguardente|\bcafe\b|\bcha\b|\bsal\b|especiaria|oregaos|canela|piment[ao]|\bcravo\b|noz[- ]moscada|\blouro\b|coentro|\bsalsa\b|tomilho|alecrim|cominho|acafrao|caril|colorau|paprica|azeite|graos? de cafe/;
// categorias de LOJA/OFF de alimento
const FOOD_CAT = /mercearia|vinho|vinos|fresco|legume|fruta|iogurte|laticinio|lactic|\bmassa|arroz|charcutaria|chouri|molho|tempero|\bcarne|peixe|marisco|padaria|bebida|refrigerante|\bsumo|\bsnack|\bdoce|chocolate|congelado|cereai|conserva|queijo|\bleite|\bovos?\b|cafe|\bcha\b|agua|azeite|farinha|acucar|biscoito|bolacha|\bpao\b|gelado|enlatado|aperitivo|talho/;

const has = (re, s) => re.test(norm(s));
const temFG = (fg) => (Array.isArray(fg) ? fg.length > 0 : !!(fg && String(fg).trim() && String(fg).trim() !== '[]' && String(fg).trim() !== '{}'));

export function tipoProduto({ nome = '', temNutricao = false, foodGroups = null, categoria = '' } = {}) {
  if (temNutricao || temFG(foodGroups)) return 'food';   // 1. tem nutrição/food_groups
  if (has(NON_FOOD_NOME, nome)) return 'non_food';        // 2. nome claramente não-alimento
  if (has(NON_FOOD_CAT, categoria)) return 'non_food';    // 3. categoria não-alimento
  if (has(FOOD_NOME, nome)) return 'food';                // 4. alimento sem nutrição (água/vinho/especiaria)
  if (has(FOOD_CAT, categoria)) return 'food';            // 5. categoria de alimento
  return null;                                            // ambíguo
}

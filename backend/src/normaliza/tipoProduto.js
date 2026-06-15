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
// categorias de LOJA/OFF de não-alimento (PT + ES — o catálogo tem Mercadona)
const NON_FOOD_CAT = /beleza|higien|cabelo|capilar|\blimpeza|limpieza|\bhogar\b|deterg|\bcorpo\b|corporal|cuidado facial|desodoriz|\broupa|papelaria|papeleria|\bpapel\b|\bgato\b|\bcao\b|\banimal|animais|mascota|petfood|\bcasa\b|drogaria|drogueria|cosmetic|perfum|maquilha|maquillaje|dentifric|\bdental|\bfralda|farmacia|jardim|bricolage|ferreteria|brinquedo|juguete|\blivros?\b|\blego\b|menaje|bazar|textil|champu/;
// alimentos SEM nutrição típica (devem ser 'food', não "não alimentício")
const FOOD_NOME = /\bagua\b|\bvinho|espumante|cerveja|\blicor|whisky|\brum\b|\bgin\b|\bvodka|moscatel|aguardente|\bcafe\b|\bcha\b|\bsal\b|especiaria|oregaos|canela|piment[ao]|\bcravo\b|noz[- ]moscada|\blouro\b|coentro|\bsalsa\b|tomilho|alecrim|cominho|acafrao|caril|colorau|paprica|azeite|graos? de cafe/;
// categorias de LOJA/OFF de alimento (PT + ES)
const FOOD_CAT = /mercearia|alimenta|vinho|vinos|fresco|legume|legumbre|verdura|hortaliza|fruta|iogurte|yogur|laticinio|lacteo|lactic|\bmassa\b|\bpasta\b|arroz|charcutaria|charcuteria|chouri|fiambre|embutido|molho|salsas|tempero|especias|\bcarne|peixe|pescado|marisco|\baves\b|padaria|panaderia|pasteleria|bolleria|postres|pizza|platos preparados|take.?away|bebida|refrigerante|\bsumo|\bsnack|\bdoce|chocolate|galleta|congelado|cereai|cereales|conserva|enlatado|queijo|queso|\bleite\b|\bovos?\b|\bhuevo|cafe|\bcha\b|agua|azeite|aceite|farinha|harina|acucar|azucar|biscoito|bolacha|\bpao\b|gelado|aperitivo|talho/;

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

// FUSOR de food/não-food (1.º nível do fusor de categoria — o "departamento"):
// funde os sinais por ordem de fiabilidade e devolve { tipo, via } com a PROVENIÊNCIA
// (qual sinal decidiu). Generaliza tipoProduto() acrescentando dois votos:
//  - tipoTexto: o que o VLM LEU/JULGOU do pacote (tipo_no_pacote + tipo_inferido) — texto
//    FORTE (palavras do fabricante > nome cru); entra logo após a nutrição. Ex.: nome
//    "Pérolas" (homónimo) mas tipoTexto "massa alimentícia" → food; "Vela de Cumpleaños"
//    no pacote → non_food (derruba o prior food da marca Hacendado).
//  - marcaShareFood (0..1, opcional — passo seguinte): fração de produtos 'food' da marca,
//    minada do catálogo. Especialista de departamento (Hacendado 0.99 → food; Deliplus
//    0.03 → non_food). null = sem sinal de marca.
export function decidirTipo({ nome = '', temNutricao = false, foodGroups = null, categoria = '', tipoTexto = '', marcaShareFood = null } = {}) {
  if (temNutricao || temFG(foodGroups)) return { tipo: 'food', via: 'nutricao' };
  if (tipoTexto) { // o VLM viu o produto → o seu tipo é mais fiável que o nome cru
    if (has(NON_FOOD_NOME, tipoTexto) || has(NON_FOOD_CAT, tipoTexto)) return { tipo: 'non_food', via: 'vlm-tipo' };
    if (has(FOOD_NOME, tipoTexto) || has(FOOD_CAT, tipoTexto)) return { tipo: 'food', via: 'vlm-tipo' };
  }
  if (marcaShareFood != null) { // marca especialista de departamento (mini marca_perfil)
    if (marcaShareFood >= 0.9) return { tipo: 'food', via: 'marca' };
    if (marcaShareFood <= 0.1) return { tipo: 'non_food', via: 'marca' };
  }
  const t = tipoProduto({ nome, temNutricao, foodGroups, categoria }); // cascata por nome/categoria
  return { tipo: t, via: t ? 'nome-categoria' : 'ambiguo' };
}

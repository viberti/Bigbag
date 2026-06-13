// B1 (Analise_Fontes, Fase B) — categoria com VOCABULÁRIO FECHADO: o "grupo" de
// alto nível do SKU (11 valores), calculado deterministicamente. Move para a base
// o que o frontend remendava por keywords (categoriaAlto em App.jsx) — os ids são
// OS MESMOS para a UI usar o grupo do servidor diretamente. A `categoria` texto
// livre mantém-se como detalhe; o grupo é o eixo estável para agrupar/filtrar.
// NORMALIZADORES PARTILHADOS (unificação 2026-06-13 — a revisão achou norm()
// redefinida em 7+ ficheiros). Este módulo é PURO (zero imports) e é importado
// também pelo FRONTEND (App.jsx) — não acrescentar dependências de node aqui.
//   norm     — minúsculas, sem acentos, espaços colapsados (pontuação PRESERVADA)
//   normAlfa — idem, mas pontuação vira espaço (p/ tokenizar: marca, matching)
// Variantes que FICAM próprias (de propósito): facetas.js (preserva %/),
// verificarNomes.js (compacta tudo, sem espaços).
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export const normAlfa = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Categorias alimentares que DISPENSAM ficha nutricional POR-PRODUTO (não entram na
// worklist "por identificar"): a nutrição vem da CLASSE (cereais/massas; pão, que é
// fresco-like) ou é irrelevante (álcool). Decisão do dono (2026-06-11): "vinho não
// precisa de ficha; arroz é cereal; pães comportam-se como frescos". Match por
// PALAVRA no nome canónico (regex ICU \b, MySQL 8). Fonte de verdade única.
// Álcool — nutrição irrelevante (sai da worklist, mas NÃO recebe nutrição-classe).
const DISPENSA_ALCOOL_KW = [
  'vinho', 'espumante', 'cerveja', 'whisky', 'gin', 'ginja', 'vodka', 'licor',
  'aguardente', 'sidra', 'sangria', 'vermute', 'brandy', 'tequila', 'moscatel', 'champanhe', 'conhaque',
];
// Cereais/massas + pão — nutrição da CLASSE (sai da worklist E recebe nutrição via
// tipo 'basico'). NB: o REGEXP do MySQL é accent-sensitive — manter as duas formas
// (pao/pão) porque casamos o nome canónico (acentuado) E a descrição crua (sem).
const DISPENSA_CLASSE_KW = [
  'arroz', 'esparguete', 'massa', 'macarrao', 'macarrão', 'farinha', 'cuscuz', 'penne', 'fusilli', 'talharim', 'noodles',
  'pao', 'pão', 'paes', 'pães', 'baguete', 'croissant', 'brioche', 'broa', 'tosta', 'carcaca', 'carcaça', 'pain',
];
// Valor com `\\b` para sobreviver ao literal de string do MySQL (interpolado no SQL).
export const DISPENSA_FICHA_RE = `\\\\b(${[...DISPENSA_ALCOOL_KW, ...DISPENSA_CLASSE_KW].join('|')})\\\\b`;
// Subconjunto que GANHA nutrição-de-classe (cereais/massas/pão) — para o backfill.
export const DISPENSA_CLASSE_RE = `\\\\b(${DISPENSA_CLASSE_KW.join('|')})\\\\b`;

export const GRUPOS = [
  { id: 'frutas', t: ['fruta', 'fruit', 'legume', 'vegetal', 'vegetable', 'verdura', 'hortic', 'hortofrut', 'salada', 'cogumelo', 'meloa', 'melao', 'melancia', 'salsa', 'batata', 'abobora', 'milho', 'cenoura'] },
  { id: 'carne', t: ['carne', 'meat', 'charcutaria', 'fiambre', 'ham', 'enchido', 'salsicha', 'sausage', 'salam', 'talho', 'aves', 'poultry', 'bovino', 'beef', 'suino', 'pork', 'porco', 'frango', 'chicken', 'peru', 'presunto', 'chourico', 'pate', 'jamon', 'embutido', 'salchich', 'charcuter'] },
  { id: 'peixe', t: ['peixe', 'fish', 'marisco', 'seafood', 'bacalhau', 'atum', 'tuna', 'salmao', 'salmon', 'pescado', 'sardinha', 'cavala', 'biqueir', 'peixaria', 'pescader'] },
  { id: 'lacticinios', t: ['laticinio', 'lacteo', 'lacte', 'dair', 'leite', 'milk_', 'queijo', 'cheese', 'iogurte', 'yogurt', 'yoghurt', 'manteiga', 'butter', 'nata', 'ovo', 'ovos', 'egg', 'eggs', 'requeijao', 'kefir', 'skyr', 'burrata', 'mozzarella', 'gorgonzola', 'queso'] },
  // padaria = só pão/pastelaria FRESCA (como o corredor da loja). Massa/arroz/
  // farinha/cereais são SECOS → mercearia (as lojas classificam-nos aí; o
  // mapeamento-de-loja segue o mercado). A nutrição-por-classe dos básicos é um
  // mecanismo SEPARADO (DISPENSA_CLASSE) e não muda com isto.
  { id: 'padaria', t: ['pao', 'bread', 'padaria', 'bakery', 'pastelaria', 'tosta', 'wrap', 'croissant', 'broa', 'baguete', 'brioche', 'tortilha', 'tortilla', 'panaderia', 'bolleria', 'pan'] },
  { id: 'bebidas', t: ['bebida', 'beverage', 'drink', 'agua', 'water', 'sumo', 'juice', 'refrigerante', 'soda', 'cerveja', 'beer', 'vinho', 'wine', 'ice tea', 'iced tea', 'cha gelado', 'cha frio', 'alcool', 'alcohol', 'espumante', 'nectar_', 'nectare', 'cerveza', 'vino', 'bodega', 'zumo'] },
  { id: 'doces', t: ['chocolate', 'doce', 'sweet', 'guloseima', 'candy', 'gelado', 'ice cream', 'snack', 'bolacha', 'biscuit', 'biscoito', 'cookie', 'sobremesa', 'dessert', 'mel', 'honey', 'compota', 'marmelada', 'jam'] },
  { id: 'congelados', t: ['congelado', 'frozen', 'ultracongelado'] },
  { id: 'higiene', t: ['higiene', 'hygiene', 'limpeza', 'cleaning', 'nao alimentar', 'detergente', 'detergent', 'papel', 'paper', 'cosmetic', 'sabonete', 'champo', 'beleza', 'lixivia', 'amaciador', 'champu', 'maquillaje', 'perfume', 'desodor', 'jabon', 'colonia', 'cabello', 'parafarmacia'] },
  { id: 'mercearia', t: ['mercearia', 'grocery', 'conserva', 'azeite', 'olive oil', 'oleo', 'oil', 'molho', 'sauce', 'tempero', 'especiaria', 'spice', 'enlatado', 'canned', 'sal', 'salt', 'acucar', 'sugar', 'leguminosa', 'feijao', 'grao', 'lentilha', 'lenteja', 'tofu', 'massa', 'macarrao', 'penne', 'fusilli', 'talharim', 'esparguete', 'espaguete', 'noodles', 'lasanha', 'gnocchi', 'nhoque', 'arroz', 'rice', 'farinha', 'flour', 'cuscuz', 'cereai', 'cereal', 'breakfast', 'muesli', 'granola', 'aveia', 'cotovelo', 'cotovelinho', 'conchigli', 'capellini', 'vermicell', 'aletria', 'linguine', 'pappardel', 'paccheri', 'bucatini', 'rigaton', 'tagliatel', 'fettuccin', 'farfalle', 'tortelin', 'raviol', 'cannellon', 'canelone', 'orecchiet', 'ditalini', 'fideo', 'azeitona', 'aceituna', 'encurtido', 'aperitivo', 'picles', 'pickles', 'passata', 'palmito', 'cafe', 'coffee', 'cha', 'tea', 'infus', 'descafeinado'] },
];
export const GRUPO_OUTROS = 'outros';
export const GRUPOS_IDS = [...GRUPOS.map((g) => g.id), GRUPO_OUTROS];

// food_groups do OFF (tags en:) → grupo. Cobertura direta quando há ficha OFF.
const FOOD_GROUPS = {
  'fruits-and-vegetables': 'frutas', 'fruits': 'frutas', 'vegetables': 'frutas',
  'meat': 'carne', 'meat-other-than-poultry': 'carne', 'poultry': 'carne', 'processed-meat': 'carne',
  // NB: 'fish-meat-eggs' (pai agregado no DAG do OFF) foi REMOVIDO de propósito:
  // mapeá-lo a carne engolia atum/claras-de-ovo (auditoria 2026-06-11) — quando o
  // OFF só dá o pai, deixa o NOME decidir.
  'fish-and-seafood': 'peixe',
  'milk-and-dairy-products': 'lacticinios', 'dairy-desserts': 'lacticinios', 'cheese': 'lacticinios', 'eggs': 'lacticinios',
  'cereals-and-potatoes': 'mercearia', 'bread': 'padaria', 'breakfast-cereals': 'mercearia', 'cereals': 'mercearia', // cereais = mercearia desde 2026-06-12 (o mapa tinha ficado na taxonomia antiga)
  'beverages': 'bebidas', 'alcoholic-beverages': 'bebidas', 'unsweetened-beverages': 'bebidas', 'sweetened-beverages': 'bebidas',
  'sugary-snacks': 'doces', 'salty-snacks': 'doces', 'sweets': 'doces', 'biscuits-and-cakes': 'doces', 'ice-cream': 'doces',
  'fats-and-sauces': 'mercearia', 'dressings-and-sauces': 'mercearia', 'fats': 'mercearia', 'canned-foods': 'mercearia',
};

// Match por INÍCIO de palavra, não substring ("VERMELHA" continha "mel" → Doces;
// "CHAMPO" continha "cha" → Bebidas). Termos curtos (≤3) exigem palavra inteira.
const _re = new Map();
function termRe(term) {
  let re = _re.get(term);
  if (!re) {
    // sufixo '_' no termo = PALAVRA INTEIRA obrigatória (ex.: 'milk_' não pode
    // casar "Milka" — apanhado pelo LLM-juiz). Sem sufixo, termos >3 continuam
    // a aceitar continuação ('iogurte'→'iogurtes', 'hortic'→'hortícolas').
    const inteira = term.endsWith('_');
    const t = inteira ? term.slice(0, -1) : term;
    re = new RegExp(`(^|[^a-z0-9])${t}${inteira || t.length <= 3 ? '(?![a-z0-9])' : ''}`);
    _re.set(term, re);
  }
  return re;
}

// FRASES que desambiguam ANTES do voto por termo solto (vencem o loop): um termo
// de produce ('fruta', 'milho') dentro de uma frase muda de grupo. Regra GERAL,
// por classe — não por artigo. norm() já tirou acentos e baixou as maiúsculas.
//  - frutos secos / fruta seca/desecada/desidratada = aperitivo de PRATELEIRA
//    (amêndoa, noz, sésamo, passas…), NÃO fruta fresca → mercearia. ('fruta'
//    casava "fruta desecada" e "frutos secos" e mandava tudo para Frutas.)
//  - milho/maíz DOCE = a conserva de milho (produto de prateleira, o corredor da
//    loja é "Conservas"), distinta do milho fresco/espiga → mercearia.
const FRASE_GRUPO = [
  [/(^|[^a-z])(frutos?\s+secos?|frutos?\s+desecad\w*|fruta\s+(seca|desecada|deshidratada|desidratada))/, 'mercearia'],
  [/(^|[^a-z])(milho\s+doce|maiz\s+dulce)/, 'mercearia'],
];

export function grupoDeTexto(texto) {
  const s = norm(texto);
  if (!s) return GRUPO_OUTROS;
  for (const [re, g] of FRASE_GRUPO) if (re.test(s)) return g;
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

// Chave de CONSOLIDAÇÃO de um item da lista de compras: "Ovo", "ovos", "OVOS " e
// "Bananas"/"banana" são o MESMO item — minúsculas, sem acentos, cada token no
// singular canónico. Itens com a mesma chave somam quantidades em vez de duplicar.
export function chaveItemLista(nome) {
  return String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(singularizar).join(' ');
}

// Um token do PEDIDO casa um token do NOME quando: são iguais; são o MESMO
// singular (plural⇄singular nos dois sentidos, incluindo irregulares — pão/pães,
// limão/limões — via singularizar, NÃO por prefixo: prefixo largo foi o que fez
// "sal" casar "salmão"); ou o nome é a raiz de um pedido mais longo (nome ≥4,
// p/ abreviaturas tipo "BOL"→"bolachas" ao contrário).
// Partilhado pelos matchers por token (lista, consulta, ficha) para não divergirem.
// SINÓNIMOS entre línguas/grafias no MATCHING (2026-06-13, revisão 3.2). Semente
// curada: casos reais (esparguete↔spaghetti do OFF; iogurte↔yogur do Mercadona)
// + minados dos 3.565 pares mesmo-EAN entre fontes (tampão↔tampones, mozarela↔
// mozzarella, humus↔hummus). A mineração automática rendeu POUCO além disto —
// os catálogos PT escrevem parecido; crescer este mapa com casos reais, não em massa.
// Só no MATCHING (tokenCasa) — NÃO na chave de consolidação (chaveItemLista).
const SINONIMOS = {
  pickle: 'picle', spaghetti: 'esparguete', espaguete: 'esparguete',
  gnocchi: 'nhoque',
  mozzarella: 'mozarela',
  hummus: 'humus',
  tampone: 'tampao', // chave PÓS-singularização ('tampones'→singularizar→'tampone')
  yogur: 'iogurte', yogurt: 'iogurte',
  queso: 'queijo',
};
const sinCanon = (t) => SINONIMOS[t] || t;
export function tokenCasa(nomeTok, pedidoTok) {
  if (nomeTok === pedidoTok) return true;
  const a = sinCanon(singularizar(nomeTok)), b = sinCanon(singularizar(pedidoTok));
  if (a === b) return true;
  if (pedidoTok.startsWith(nomeTok) && nomeTok.length >= 4) return true;
  return false;
}

// Corta o GENÉRICO da frente do nome no display da lista (revisão 3.7a — a lógica
// vivia inline no App.jsx sem testes). Regras: só corta se o tipo tem genérico
// (GEN_RE), há mais palavras, e a seguinte NÃO é conector ("Pão de Forma" intacto).
// Recebe e devolve o ARRAY de palavras (o chamador trata da marca/join).
// QUANTIDADE embutida no NOME (regra geral do dono, 2026-06-14: "20 Saq" do chá
// Pyramid é quantidade, não nome — vale p/ qualquer unidade de CONTAGEM/embalagem).
// (a) par "número + unidade" sai em qualquer posição ("20 Saq", "2 Rolos",
// "10 Doses"); (b) unidade de embalagem ÓRFÃ no fim também sai ("… Saquetas").
// Partilhada: a fusão da ficha limpa na origem; a lista limpa na exibição
// (nomes já gravados). Nunca esvazia.
const UNIDADES_CONTAGEM = 'saqs?|saquetas?|saquinhos?|sach[eê]s?|sachets?|c[áa]psulas?|caps|doses?|rolos?|folhas?|pastilhas?|comprimidos?|unidades?|unid|uni|un|pe[çc]as?|lavagens?';
const RE_NUM_UNIDADE = new RegExp(`(^|\\s)\\d+\\s*(${UNIDADES_CONTAGEM})(?=\\s|$)`, 'gi');
const RE_UNIDADE_FIM = new RegExp(`\\s+(${UNIDADES_CONTAGEM})\\s*$`, 'i');
export function cortarQuantidadeNome(nome) {
  if (!nome) return nome;
  let r = String(nome).replace(RE_NUM_UNIDADE, ' ').replace(/\s{2,}/g, ' ').trim();
  const semFim = r.replace(RE_UNIDADE_FIM, '').trim();
  if (semFim) r = semFim; // unidade órfã no fim ("… Saquetas") sai se sobrar nome
  return r || String(nome).trim();
}

export function cortarGenerico(words, tipoId) {
  const re = GEN_RE[tipoId];
  if (re && words.length > 1 && re.test(norm(words[0])) && !CONECTORES.has(norm(words[1]))) return words.slice(1);
  return words;
}

// Grupo de um SKU a partir das fontes disponíveis, por força decrescente:
// food_groups do OFF (autoritativo) → NOME → categoria (texto). O nome do produto
// é mais fiável que a categoria de LOJA, que mistura prateleiras: "Charcutaria e
// Queijos" casava 'charcutaria'→carne ANTES de 'queijo'→lacticínios, e punha os
// queijos na carne. O nome ("Queijo Grana Padano") desambigua; a categoria é a rede.
// Grupo a partir do NOME de um produto, com prioridade ao SUBSTANTIVO-CABEÇA:
// "Croissant de Manteiga" é padaria (croissant), não lacticínios (manteiga);
// "Esparguete com Ovo" é massa, não ovo; "Patê de Alho e Salsa" é carne, não
// salsa. Era a fraqueza nº 1 apanhada pelo LLM-juiz (auditoria 2026-06-11):
// uma palavra forte de OUTRO grupo no meio do nome vencia, porque grupoDeTexto
// devolve o 1.º grupo cujo termo apareça em QUALQUER posição. Tenta primeiro o
// segmento antes do 1.º conector (de/com/em/para/e); só depois o texto todo.
// NB: para CATEGORIAS de loja continua o full-text (não têm cabeça única).
export function grupoDeNome(nome) {
  const n = norm(nome);
  if (!n) return GRUPO_OUTROS;
  const cabeca = n.split(/\s(?:de|do|da|dos|das|com|em|para|e)\s/)[0].trim();
  if (cabeca && cabeca !== n) {
    const g = grupoDeTexto(cabeca);
    if (g !== GRUPO_OUTROS) return g;
  }
  return grupoDeTexto(n);
}

// Ordem dos sinais INVERTIDA (decisão do dono, 2026-06-13): NOME antes dos
// food_groups do OFF — coerente com o resolvedor único (o nosso vocabulário e o
// catálogo valem mais que o crowdsourcing do OFF). A ordem antiga (OFF primeiro)
// acumulava exceções-remendo (bebidas-vs-lácteos, bebidas-vs-mercearia) e
// contaminava o ouro: "Patê de Alho" era padaria porque o OFF dizia 'bread';
// "Muesli" era padaria por 'breakfast-cereals' quando a loja diz mercearia.
export function grupoDe({ foodGroups = null, categoria = null, nome = null } = {}) {
  // congelados: a categoria de loja "Congelados" é um sinal FÍSICO inequívoco
  // (batata palitos congelada organiza-se nos congelados) — vence até o nome.
  if (grupoDeTexto(categoria) === 'congelados') return 'congelados';
  const porNome = grupoDeNome(nome);
  if (porNome !== GRUPO_OUTROS) return porNome;
  for (const fg of Array.isArray(foodGroups) ? foodGroups : []) {
    const g = FOOD_GROUPS[String(fg).replace(/^en:/, '')];
    if (g) return g;
  }
  return grupoDeTexto(categoria);
}

// ── TIPO-CONSUMIDOR da lista de compras (PARTILHADO front/back, 2026-06-13) ───
// A lista agrupa pelo "o que a coisa É" (Massa, Pão, Cereais, Conservas + Mercearia
// residual) — lente DISTINTA do grupo-de-loja acima (decisão do dono, 2026-06-12).
// Vivia duplicado no frontend (App.jsx) com vocabulário paralelo ao GRUPOS — a
// revisão técnica achou 3+ cópias (front + back + réplicas inline em testes e2e).
// Agora a DEFINIÇÃO vive aqui e o frontend importa (módulo puro, ver cabeçalho).
export const TIPOS_NOME = [ // regexes sobre norm() (minúsculas, SEM acentos)
  // NOTA: "pasta" sozinho NÃO classifica (ambíguo: pasta de dentes/amendoim/folhada).
  // A massa real vem pelo formato (penne, cannelloni…) ou por "massa"/marca. No
  // DISPLAY, porém, "pasta" é genérico a cortar no tipo massa (ver GEN_RE).
  ['massa', /(^|[^a-z])(massas?|penne|pennette|esparguete|espaguete|macarrao|fusilli|talharim|tagliatel|fettuccin|farfalle|rigaton|lasanha|noodles|gnocchi|nhoque|cuscuz|raviol|tortelin|fideos?|cotovelos?|cotovelinhos?|conchigli|capellini|vermicell|aletria|linguine|pappardel|paccheri|bucatini|cannellon|canelone|orecchiet|ditalini|estrellas)/],
  ['cereais', /(^|[^a-z])(cereais?|muesli|granola|aveia|flocos|cornflake|chocapic|estrelitas)/],
  // família do TOMATE em conserva (dono, 2026-06-13: polpas/passatas/pelati são
  // uma família culinária própria, não "mercearia" nem "conservas" genéricas).
  // 'polpa' SÓ com 'de tomate' (polpa de fruta é outra coisa).
  ['tomate', /(^|[^a-z])(polpa de tomate|passatas?|pelati|tomate pelado|concentrado de tomate|tomate triturado)/],
  ['conservas', /(^|[^a-z])(conserva|enlatad|em lata|pelad[oa])/], // marcador explícito (atum "fresco" fica peixe)
  ['pao', /(^|[^a-z])(pao|paes|tosta|wrap|broa|baguet|croissant|brioche)/],
  // Café, Chá e Infusão (dono, 2026-06-13 — a folha do Auchan virou secção da
  // lista). 'cha' exige fronteira e NÃO seguido de gelado/frio (esses são
  // bebidas prontas); 'chave/salsicha' não casam (fronteira + ).
  ['cafe_cha', /(^|[^a-z])(chas?\b(?! gelad| fri)|teas?\b|cafes?\b|infus|descafeinado|tisana|rooibos|camomila|cidreira|earl grey)/],
];
export function tipoConsumidor(grupo, nome, marca) {
  const s = norm(nome);
  for (const [id, re] of TIPOS_NOME) if (re.test(s)) return id;
  // a MARCA é fabricante de massa ("Pasta Berruto", "Pasta Zara") → massa. Apanha
  // nomes errados/estranhos sem categoria (ex.: "Concchiglioni" com cc duplo).
  if (marca && /(^|[^a-z])(pasta|massa)([^a-z]|$)/.test(norm(marca))) return 'massa';
  if (['frutas', 'carne', 'peixe', 'lacticinios', 'bebidas', 'doces', 'congelados', 'higiene'].includes(grupo)) return grupo;
  if (grupo === 'padaria') return 'pao';        // padaria sem massa/cereais ≈ pão
  if (grupo === 'mercearia') return 'mercearia'; // residual dos secos (arroz, farinha, azeite, sal…)
  return 'outros';
}
// genéricos a CORTAR do nome no display, POR TIPO (lógica do dono: a palavra
// ignorada está associada à categoria — "pasta" corta-se em Massa, fica em
// "Pasta de Dentes"). CONECTORES protegem nomes compostos ("Pão de Forma").
export const GEN_RE = { massa: /^(massas?|pasta)$/, pao: /^(pao|paes)$/, cereais: /^cereais?$/, conservas: /^conservas?$/ };
export const CONECTORES = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'para', 'e', 'em', 'sem', 'ao']);

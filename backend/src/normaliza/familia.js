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
  azeite:             { label: 'Azeite',                    dep: 'food', grupo: 'mercearia', seccao: 'condimentos',  unidade: 'l'  },
  oleo:               { label: 'Óleo',                      dep: 'food', grupo: 'mercearia', seccao: 'condimentos',  unidade: 'l'  },
  especiarias:        { label: 'Especiarias e Temperos',    dep: 'food', grupo: 'mercearia', seccao: 'condimentos',  unidade: 'kg' },
  farinha_acucar:     { label: 'Farinhas, Açúcar e Fermentos', dep: 'food', grupo: 'mercearia', seccao: 'mercearia', unidade: 'kg' },
  cafe:               { label: 'Café',                      dep: 'food', grupo: 'mercearia', seccao: 'cafe_cha',    unidade: 'kg' },
  cha_infusoes:       { label: 'Chá e Infusões',            dep: 'food', grupo: 'mercearia', seccao: 'cafe_cha',    unidade: 'kg' },
  // — LATICÍNIOS (grupo 'lacticinios' c/ c; secção 'laticinios' sem c) — Fase 2 (2026-06-18) —
  iogurte:            { label: 'Iogurtes',                   dep: 'food', grupo: 'lacticinios', seccao: 'laticinios', unidade: 'un' },
  queijo:             { label: 'Queijos',                    dep: 'food', grupo: 'lacticinios', seccao: 'laticinios', unidade: 'kg' },
  leite:              { label: 'Leite',                      dep: 'food', grupo: 'lacticinios', seccao: 'laticinios', unidade: 'l'  },
  manteiga:           { label: 'Manteiga e Margarina',       dep: 'food', grupo: 'lacticinios', seccao: 'laticinios', unidade: 'kg' },
  natas:              { label: 'Natas e Cremes',             dep: 'food', grupo: 'lacticinios', seccao: 'laticinios', unidade: 'l'  },
  requeijao:          { label: 'Requeijão',                  dep: 'food', grupo: 'lacticinios', seccao: 'laticinios', unidade: 'kg' },
  ovos:               { label: 'Ovos',                       dep: 'food', grupo: 'lacticinios', seccao: 'laticinios', unidade: 'un' },
  // — DOCES —
  chocolate:          { label: 'Chocolates',                 dep: 'food', grupo: 'doces',       seccao: 'doces',     unidade: 'kg' },
  bolacha:            { label: 'Bolachas e Biscoitos',       dep: 'food', grupo: 'doces',       seccao: 'doces',     unidade: 'kg' },
  cacau:              { label: 'Cacau e Achocolatados',      dep: 'food', grupo: 'doces',       seccao: 'doces',     unidade: 'kg' },
  gelado:             { label: 'Gelados',                    dep: 'food', grupo: 'doces',       seccao: 'doces',     unidade: 'l'  },
  doce_compota:       { label: 'Doces e Compotas',           dep: 'food', grupo: 'doces',       seccao: 'doces',     unidade: 'un' },
  bolo:               { label: 'Bolos e Sobremesas',         dep: 'food', grupo: 'doces',       seccao: 'doces',     unidade: 'un' },
  // — BEBIDAS —
  sumo:               { label: 'Sumos e Néctares',           dep: 'food', grupo: 'bebidas',     seccao: 'bebidas',   unidade: 'l'  },
  refrigerante:       { label: 'Refrigerantes',              dep: 'food', grupo: 'bebidas',     seccao: 'bebidas',   unidade: 'l'  },
  agua:               { label: 'Água',                       dep: 'food', grupo: 'bebidas',     seccao: 'bebidas',   unidade: 'l'  },
  cerveja:            { label: 'Cervejas',                   dep: 'food', grupo: 'bebidas',     seccao: 'bebidas',   unidade: 'l'  },
  vinho:              { label: 'Vinhos',                     dep: 'food', grupo: 'bebidas',     seccao: 'bebidas',   unidade: 'l'  },
  // — CHARCUTARIA (enchidos/fiambres/curados; distinta da CARNE FRESCA do talho) — as fontes já
  //   separam: Continente classifica fiambre como "Charcutaria", a ficha tem "Frescos/Charcutaria".
  charcutaria:        { label: 'Charcutaria',                dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  // — CARNE por ESPÉCIE (dono, 2026-06-27): o grupo 'carne' é o corredor; a família é a espécie exibida.
  //   Cortes sem espécie no nome (ex.: "Peito Familiar", "Carne Picada") caem no rótulo do grupo ("Carne").
  frango:             { label: 'Frango',                    dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  boi:                { label: 'Boi',                        dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  porco:              { label: 'Porco',                      dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  peru:               { label: 'Peru',                       dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  pato:               { label: 'Pato',                       dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  cordeiro:           { label: 'Cordeiro',                   dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  carne_misto:        { label: 'Misto',                      dep: 'food', grupo: 'carne',       seccao: 'carne',     unidade: 'kg' },
  // — FRESCOS hortofrutícolas: FRUTA vs VEGETAIS separados (dono, 2026-06-27) — o grupo 'frutas' é o
  //   corredor (lente de loja); a família é o que se EXIBE. Produce sem match no vocábulo cai no rótulo
  //   combinado do grupo ("Frutas e Vegetais"), honesto para os ambíguos (saladas/mix).
  fruta:              { label: 'Frutas',                     dep: 'food', grupo: 'frutas',      seccao: 'frutas',    unidade: 'kg' },
  vegetal:            { label: 'Vegetais',                   dep: 'food', grupo: 'frutas',      seccao: 'frutas',    unidade: 'kg' },
};

export const familia = (slug) => FAMILIAS[slug] || null;

// Reusa as regexes de massa/cereais já provadas em TIPOS_NOME (zero drift com o golden).
const T = Object.fromEntries(TIPOS_NOME);

// Classificador determinístico NOME → família (sobre norm(): minúsculas, sem acentos).
// Ordem = específico → geral (o 1.º que casa vence). Só faz sentido DENTRO da mercearia
// alimentar; o fusor aplica-o nesse contexto (não a bebidas/frescos com os mesmos tokens).
// ORDEM = produto-TIPO (head-noun específico) primeiro; CONDIMENTOS/ingredientes (sal/azeite/molho —
// que aparecem MEIO de outros nomes) por ÚLTIMO, senão "Bolacha de Água e Sal" → especiarias.
const FAM_RE = [
  ['conservas_peixe',    /(^|[^a-z])(atum|sardinhas?|anchovas?|anchoa|cavala|\bsarda\b|biqueir[ao]|melva|filetes? de (peixe|cavala|sarda|anchova))/],
  // charcutaria = enchidos/fiambres/curados (cabeça do nome: "Fiambre …", "Presunto …", "Chouriço …")
  ['charcutaria',        /(^|[^a-z])(fiambre|presunto|chouric\w*|salsich\w*|salchich\w*|mortadela|\bsalame\b|\bsalami\b|\bpaio\b|\bbacon\b|enchidos?|embutidos?|\bjamon\b|linguica|chistorra|sobrasada|panceta|morcela|alheira|salpicao|\bpate\b|charcutar|lombo (curado|fumado|assado))/],
  // CARNE por espécie (a espécie é o que se EXIBE; cortes sem espécie ficam no grupo "Carne").
  // 'misto' primeiro (picada/mix de carnes); a espécie casa o ANIMAL, não o corte → "Bife de Atum" não casa.
  ['carne_misto',        /(^|[^a-z])(picada mista|carnes? mistas?|espetada mista|mix de carnes?|misto de carnes?)/],
  ['frango',             /(^|[^a-z])(frangos?|chicken|pollo|galinha)/],
  ['peru',               /(^|[^a-z])(\bperu\b|\bpavo\b|turkey)/],
  ['pato',               /(^|[^a-z])(\bpato\b|\bduck\b|canard|magret)/],
  ['cordeiro',           /(^|[^a-z])(cordeiro|borrego|cabrito|\blamb\b|cordero|\banho\b)/],
  ['porco',              /(^|[^a-z])(porco|suino|\bpork\b|cerdo|leitao|entremeada|febras|secretos)/],
  ['boi',                /(^|[^a-z])(\bboi\b|\bvaca\b|bovino|\bbeef\b|ternera|vitela|novilho|alcatra|picanha|maminha|fraldinha|\bacem\b)/],
  ['cafe',               /(^|[^a-z])(cafes?\b|descafeinado|expresso|espresso|capsulas? de cafe|cafe (soluvel|moido|em grao|torrado|torref)|nescafe|nespresso)/],
  ['cha_infusoes',       /(^|[^a-z])(chas?\b(?! gelad| fri)|teas?\b|infus|tisana|rooibos|camomila|cidreira|earl grey|matcha|\btilia\b|verbena)/],
  ['massa',              T.massa],
  ['arroz',              /(^|[^a-z])(arroz|basmati|risotto|risoto|arborio|carolino|\bagulha\b|jasmim)/],
  ['cereais_pa',         T.cereais],
  ['leguminosas',        /(^|[^a-z])(feij[ao]|feijoes|\bgrao\b|grao de bico|garbanzo|lentilhas?|\bervilhas?\b|\bfavas?\b)/],
  ['conservas_vegetais', /(^|[^a-z])(milho doce|\bmilho\b|tomate (pelado|triturado|frito)|polpa de tomate|passatas?|pelati|concentrado de tomate|cogumelos?|champignon|pimentos? (piquillo|morron|assados)|piquillo|palmito|alcachofra|espargos|azeitonas?|\bpickles?\b|\bpicles\b|em calda|em vinagre|cebolinhas?)/],
  // FRUTA fresca (cabeça do nome). Curto/ambíguo (maca/pera/lima/uva/figo/roma) leva fronteira à direita.
  ['fruta',              /(^|[^a-z])(maca([^a-z]|$)|macas|banana|laranjas?|tangerina|clementina|mandarina|toranja|limao|lima([^a-z]|$)|uvas?([^a-z]|$)|morango|mirtilo|framboesa|amora|groselha|pessego|nectarina|ameixa|cereja|alperce|damasco|kiwi|mangas?([^a-z]|$)|abacaxi|ananas|melao|melancia|meloa|papaia|papaya|maracuja|figo([^a-z]|$)|figos|roma([^a-z]|$)|diospiro|caqui|lichia|tamara|abacate|goiaba|acai|pitaya|nespera|marmelo|pera([^a-z]|$)|peras|frutos vermelhos|frutos do bosque)/],
  // VEGETAIS/hortícolas frescos (legumes-vagem = leguminosas, captados acima; tomate-conserva idem).
  ['vegetal',            /(^|[^a-z])(cenoura|batata|cebola|cebolinha|\balho\b|alho frances|alface|couves?|brocolos|broculos|repolho|espinafres?|acelga|rucula|agriao|\bnabo\b|nabica|rabanete|beterraba|\baipo\b|funcho|abobora|courgette|curgete|abobrinha|pepino|pimento([^a-z]|$)|pimentos([^a-z]|$)|pimentao|\btomate\b|beringela|berinjela|grelos|alcachofra|cogumelos?|champignon|coentros|hortela|chuchu|quiabo|mandioca|inhame|salada|hortic|verduras?|legumes?|vegeta)/],
  ['farinha_acucar',     /(^|[^a-z])(farinha|\bacucar\b|azucar|fermento (em po|de padeiro|quimico)|levedura|gelatina (neutra|em po)|maizena|amido de milho|\bfecula)/],
  // — LATICÍNIOS (Fase 2) — requeijão antes de queijo; natas antes de leite (creme de leite → natas) —
  ['ovos',               /(^|[^a-z])(ovos?\b|clara de ovo|claras de ovo|gemas? de ovo|ovo de codorniz|huevos?\b)/],
  ['requeijao',          /(^|[^a-z])(requeij[ao]|ricott?a)/],
  ['iogurte',            /(^|[^a-z])(iogurtes?|yogur|yoghurt|\bskyr\b|\bkefir\b)/],
  ['queijo',             /(^|[^a-z])(queijos?|mozz?arel?la|mozarela|gorgonzola|\bgouda\b|flamengo|emmental|cheddar|parmesao|parmigiano|reggiano|\bbrie\b|camembert|halloumi|\bfeta\b|\bedam\b|barra de queijo)/],
  ['manteiga',           /(^|[^a-z])(manteiga|mantequilla|margarina)/],
  ['natas',              /(^|[^a-z])(natas?|creme de leite|creme fresco|creme fraiche|creme para cozinhar|nata para)/],
  ['leite',              /(^|[^a-z])(leite|leche)([^a-z]|$)/],
  // — DOCES — gelado/bolacha/cacau antes de chocolate (bolacha/gelado/achocolatado DE chocolate → o tipo) —
  ['bolo',               /(^|[^a-z])(bolos?|tortas?|queques?|madalenas?|muffins?|cupcakes?|brownies?|pastel de nata|pasteis de nata)/],
  ['gelado',             /(^|[^a-z])(gelados?|helados?|sorvetes?|gelato|ice ?cream)/],
  ['bolacha',            /(^|[^a-z])(bolachas?|biscoitos?|biscuits?|cookies?|galletas?|wafer|crackers?|tostas? )/],
  ['cacau',              /(^|[^a-z])(achocolatad[oa]|\bcacau\b|cacau em po|chocolate (em po|soluvel|instantaneo|granulado)|bebida de chocolate|nesquik|ovomaltine|nescau)/], // NÃO \bcacao\b: "cação" (peixe) normaliza p/ "cacao"
  ['chocolate',          /(^|[^a-z])(chocolates?|tablet?es?|bombons?|\bchoco\b|pralines?|kitkat|snickers|m&ms?|nutella)/],
  ['doce_compota',       /(^|[^a-z])(compotas?|marmelada|geleias?|doce de (fruta|leite|tomate|abobora)|mermelada|confiture)/],
  // — BEBIDAS — cerveja/vinho antes de sumo/refrigerante/água —
  ['cerveja',            /(^|[^a-z])(cervejas?|cerveza|\bbeer\b|\blager\b|\bipa\b|pilsner|super bock|sagres|heineken|estrella)/],
  ['vinho',              /(^|[^a-z])(vinhos?|\bvino\b|\bwine\b|espumante|champagne|sangria|moscatel|porto (tawny|ruby|tinto|branco|reserva|10 anos|20 anos))/],
  ['sumo',               /(^|[^a-z])(sumos?|\bzumo\b|nectar|\bjuice\b)/],
  ['refrigerante',       /(^|[^a-z])(refrigerantes?|coca[- ]?cola|\bcola\b|pepsi|fanta|sprite|7 ?up|gasosa|\bsoda\b|tonica|ice ?tea|cha gelado|red bull|monster|isotonic|gatorade|powerade)/],
  ['agua',               /(^|[^a-z])agua( (mineral|com gas|sem gas|das pedras|natural|de nascente|tonica))?([^a-z]|$)/],
  // — CONDIMENTOS/ingredientes por ÚLTIMO (aparecem MEIO de outros nomes) —
  ['azeite',             /(^|[^a-z])(azeite|olive oil|aceite de oliva|oleo de oliva)/],
  ['oleo',               /(^|[^a-z])(oleo (de )?(girassol|alimentar|vegetal|amendoim|colza|milho|soja|coco|linhaca|sesamo)|\boleo\b|\bolio\b|aceite (de )?(girasol|vegetal|soja))/],
  ['molhos_condimentos', /(^|[^a-z])(ketchup|maionese|mayon|mostarda|mustard|\bmolho|\bsauce\b|pesto|vinagrete?|sofrito|aioli|alioli|barbecue|teriyaki|worcester|tabasco|guacamole|\bbechamel)/],
  ['especiarias',        /(^|[^a-z])(\bsal\b|pimenta|oregaos?|oregano|canela|\bcaril\b|\bcurry\b|cominho|colorau|paprica|noz[- ]moscada|\blouro\b|\bcravo\b|acafrao|gengibre em po|tomilho|alecrim|especiaria|\btempero)/],
];

// Marcas que SÃO de massa (fabricantes) → massa, mesmo com nome estranho (caso tipoConsumidor).
const MARCA_MASSA = /(^|[^a-z])(pasta|massa)([^a-z]|$)/;

// LEFTMOST-WINS: a família cuja palavra aparece MAIS À ESQUERDA no nome vence (= prioridade da CABEÇA do
// nome). Resolve as colisões sem depender da ordem do FAM_RE: "Molho de Tomate Frito" → molhos ("molho"
// na posição 0 < "tomate"), "Bolacha de Água e Sal" → bolacha ("bolacha" 0 < "sal"). Empate de posição
// → desempata pela ordem do FAM_RE (específico→geral). Mantém os roll-ups e o MARCA_MASSA de fallback.
// "manteiga" como VARIEDADE de outro alimento (abóbora/alface/feijão/pera/milho manteiga, butternut)
// NÃO é a manteiga (lacticínio): é o qualificador de um vegetal/legume/fruta. A família da manteiga
// só vale quando "manteiga/margarina" é a CABEÇA, não um adjetivo a seguir a um produto. Regra geral.
const RE_MANTEIGA_VARIEDADE = /(abobora|alface|feijao|feijoes|fava|favas|pera|peras|milho|batata|cacau)\s+manteig|butternut/;
// CONSERVA não é fresco: fruta/vegetal "em calda/conserva/lata/enlatado" é conserva (não o fresco).
// O nome da fruta vem à cabeça e ganharia por posição → este guard re-roteia para conservas_vegetais.
const RE_CONSERVA_HORTOFRUT = /(em calda|em conserva|enlatad|\bem lata\b|\d+\s*latas?)/;
export function familiaPorNome(nome, marca = null) {
  const s = norm(nome);
  if (s) {
    let best = null, bestIdx = Infinity;
    for (const [slug, re] of FAM_RE) {
      const mm = re.exec(s);
      if (!mm) continue;
      if (slug === 'manteiga' && RE_MANTEIGA_VARIEDADE.test(s)) continue; // "abóbora manteiga" ≠ manteiga
      if (mm.index < bestIdx) { best = slug; bestIdx = mm.index; }
    }
    if (best) {
      if ((best === 'fruta' || best === 'vegetal') && RE_CONSERVA_HORTOFRUT.test(s)) return 'conservas_vegetais';
      return best;
    }
  }
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

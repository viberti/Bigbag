// A6 (Analise_Fontes §3.3) — vocabulário ÚNICO de facetas DISCRIMINANTES, em 3
// classes com políticas distintas (Taxonomia §11.2/§11.3):
//   SABOR — morango ≠ baunilha: valores diferentes nos DOIS lados = produtos
//           diferentes (gate duro). "natural" (liso) é um VALOR, não ausência.
//   TEOR  — magro ≠ meio-gordo ≠ gordo: idem.
//   DIETA — sem lactose / zero / light / proteína / integral / bio.
// MULTILINGUE: o catálogo e o OFF trazem nomes em ES/EN/FR (fresa=strawberry=
// morango) — os sinónimos canonicalizam antes de comparar.
// Política do AUSENTE: um lado declara, o outro omite → NÃO é conflito nem
// igualdade — é "ausente" (na prática: nunca auto-match; vai ao juiz/operador).
// Partilhado pelos 3 sítios: chave do Mestre, matching nome→EAN, matching talão→SKU.

const SABORES = {
  morango: ['fresa', 'strawberry', 'fraise', 'morangos'],
  baunilha: ['vainilla', 'vanilla', 'vanille'],
  chocolate: ['choco', 'cacau', 'cacao', 'chocolat', 'cioccolato'],
  coco: ['coconut'],
  limao: ['limon', 'lemon', 'citron'],
  lima: ['lime'],
  laranja: ['naranja', 'orange'],
  ananas: ['abacaxi', 'pina', 'pineapple'],
  pessego: ['melocoton', 'peach', 'peche'],
  banana: ['platano'],
  manga: ['mango'],
  framboesa: ['frambuesa', 'raspberry'],
  mirtilo: ['arandano', 'blueberry', 'mirtilos'],
  cereja: ['cereza', 'cherry'],
  ginja: [],
  ameixa: ['ciruela', 'plum'],
  maca: ['manzana', 'apple'],
  pera: ['pear'],
  kiwi: [],
  figo: ['higo', 'fig'],
  maracuja: ['passionfruit'],
  uva: ['grape'],
  roma: ['granada', 'pomegranate'],
  'frutos vermelhos': ['frutos rojos', 'red fruits', 'silvestres', 'frutas vermelhas'],
  tropical: [],
  citrinos: ['citricos', 'citrus'],
  caramelo: ['caramel', 'toffee'],
  cafe: ['coffee', 'cappuccino'],
  avela: ['avelas', 'avellana', 'hazelnut', 'noisette'],
  amendoa: ['amendoas', 'almendra', 'almond'],
  noz: ['nozes', 'nuez', 'walnut'],
  'caju': [],
  macadamia: [],
  pistacio: ['pistacho', 'pistachio'],
  mel: ['miel', 'honey'],
  menta: ['hortela', 'mint'],
  canela: ['canela', 'cinnamon'],
  gengibre: ['jengibre', 'ginger'],
  stracciatella: [],
  tiramisu: [],
  oreo: [],
  cookies: [],
  natas: [],
  aveia: ['avena', 'oat', 'oats'],
  espelta: ['spelt'],
  natural: ['liso', 'plain', 'sin sabor'],
};

const TEOR = {
  magro: ['magra', 'desnatado', 'desnatada', 'descremado', 'descremada', 'skimmed', '0%'],
  'meio-gordo': ['meio gordo', 'meia gorda', 'm/g', 'semidesnatado', 'semidesnatada', 'semi-desnatado', 'semi'],
  gordo: ['gorda', 'inteiro', 'inteira', 'entero', 'entera', 'whole'],
};

const DIETA = {
  'sem lactose': ['sin lactosa', 'lactose free', '0% lactose'],
  'sem gluten': ['sin gluten', 'gluten free'],
  zero: ['sem acucar', 'sin azucar', 'sugar free', 'zero acucar'],
  light: ['lite', 'ligeiro', 'ligeira', 'magro light'],
  proteina: ['protein', 'proteico', 'high protein', 'proteinas'],
  integral: ['wholegrain', 'whole grain', 'completo'],
  bio: ['organic', 'organico', 'eco', 'biologico'],
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%/ ]/g, ' ').replace(/\s+/g, ' ').trim();

// índices sinónimo→canónico (frases multi-palavra testadas por substring)
function indexar(vocab) {
  const uni = new Map(), frases = [];
  for (const [canon, sins] of Object.entries(vocab)) {
    for (const v of [canon, ...sins]) {
      const n = norm(v);
      if (n.includes(' ')) frases.push([n, canon]);
      else uni.set(n, canon);
    }
  }
  return { uni, frases };
}
const IDX = { sabor: indexar(SABORES), teor: indexar(TEOR), dieta: indexar(DIETA) };

// Valores canónicos por classe presentes no texto: { sabor:Set, teor:Set, dieta:Set }
export function facetasDe(texto) {
  const s = ` ${norm(texto)} `;
  const toks = s.trim().split(' ').filter(Boolean);
  const out = { sabor: new Set(), teor: new Set(), dieta: new Set() };
  for (const classe of ['sabor', 'teor', 'dieta']) {
    const { uni, frases } = IDX[classe];
    for (const t of toks) { const c = uni.get(t); if (c) out[classe].add(c); }
    for (const [frase, canon] of frases) if (s.includes(` ${frase} `)) out[classe].add(canon);
  }
  // "natural" só é SABOR num lácteo/bebida com outros sabores possíveis; mas como
  // valor discriminante é inofensivo manter — só conflita com outro sabor explícito.
  return out;
}

const iguais = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Compara as facetas de dois textos, classe a classe:
//   'conflito' — alguma classe declarada nos DOIS lados com valores diferentes
//                (morango vs baunilha; magro vs meio-gordo) → produtos diferentes;
//   'ausente'  — um lado declara, o outro omite (teor em falta no talão) → não
//                é decidível automaticamente (juiz/operador, Taxonomia §11.3);
//   'igual'    — sem diferenças.
export function compararFacetas(a, b) {
  const fa = facetasDe(a), fb = facetasDe(b);
  let ausente = false;
  for (const classe of ['sabor', 'teor', 'dieta']) {
    const va = fa[classe], vb = fb[classe];
    if (va.size && vb.size && !iguais(va, vb)) return 'conflito';
    if (va.size !== vb.size) ausente = true;
  }
  return ausente ? 'ausente' : 'igual';
}

// Compatibilidade com a semântica histórica do saborConflito (resolverProduto):
// o TALÃO com facetas → o candidato tem de ter EXATAMENTE as mesmas (nem a mais,
// nem a menos); talão sem facetas → não bloqueia. Agora com sinónimos multilingue.
export function saborConflito(talao, cand) {
  const ft = facetasDe(talao), fc = facetasDe(cand);
  const st = new Set([...ft.sabor, ...ft.teor, ...ft.dieta]);
  if (!st.size) return false;
  const sc = new Set([...fc.sabor, ...fc.teor, ...fc.dieta]);
  return !iguais(st, sc);
}

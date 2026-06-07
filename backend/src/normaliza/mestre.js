// Construção DETERMINÍSTICA da chave do Produto Mestre (ver docs/Taxonomia_Produto.md §11).
// A extração de facetas de uma descrição é por LLM (outro módulo); ESTA camada —
// limpeza da descrição, normalização de VALORES, defaults de portão e montagem da
// chave estável — é determinística e testável. Os head-to-heads provaram que é a
// CHAVE estável (não o modelo) que decide o agrupamento: chave leve sobre-une/parte;
// chave canonicalizada → agrupamento correto.

// Normalização leve: tira acentos, baixa de caixa, colapsa espaços. Mantém / e %.
// Trata "null"/"none"/"n/a"/"-"/"?" (o LLM às vezes devolve a STRING "null") como vazio.
const VAZIOS = new Set(['null', 'none', 'n/a', 'na', '-', '?', 'nan', 'undefined']);
const ln = (x) => {
  const s = String(x ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return VAZIOS.has(s) ? '' : s;
};

// (1) LIMPEZA determinística da descrição (antes do LLM). Remove lixo estrutural:
// linha de peso colada, prefixos de quantidade, códigos de IVA, duplicações de OCR.
export function limparDescricao(d) {
  let s = String(d || '').trim();
  s = s.replace(/\s+[A-Z]?\s*kg\s*x[\d.,]+\s+[\d.,]+\s*EUR\/kg(EUR)?/gi, ''); // "B kg x0,534 6,29 EUR/kg"
  s = s.replace(/\s+[\d.,]+\s*EUR\/kg(EUR)?/gi, '');
  s = s.replace(/kgEUR/gi, 'kg'); // duplicação de OCR
  s = s.replace(/^\(\s*[A-Z]\s*\)\s*/, ''); // código IVA no início: "(A) " "(C) "
  s = s.replace(/^\d+\s+/, ''); // prefixo de quantidade: "1 "
  s = s.replace(/^C\s+(?=[A-Z])/, ''); // "C " (código IVA) seguido de palavra
  s = s.replace(/\s+[AB]$/, ''); // sufixo de código IVA "A"/"B" (não unidades G/L)
  return s.replace(/\s+/g, ' ').trim();
}

// (2) DICIONÁRIOS de normalização de VALORES (por faceta). Rede de segurança caso
// o LLM devolva a abreviatura crua em vez do valor canónico.
const DIC_TEOR = new Map([
  ['m/g', 'meio-gordo'], ['mg', 'meio-gordo'], ['meio gordo', 'meio-gordo'], ['meio-gordo', 'meio-gordo'], ['semi', 'meio-gordo'],
  ['magro', 'magro'], ['mag', 'magro'], ['0%', 'magro'], ['desnatado', 'magro'], ['ligeiro', 'magro'], ['light', 'magro'],
  ['gordo', 'gordo'], ['inteiro', 'gordo'],
]);
const DIC_ESTILO = new Map([['greg', 'grego'], ['grego', 'grego'], ['skyr', 'skyr']]);
const DIC_VARIEDADE = new Map([['royal gala', 'gala'], ['gala', 'gala'], ['golden delicious', 'golden'], ['golden', 'golden'], ['fuji', 'fuji']]);
// Categorias com plural conhecido → forma canónica única.
const DIC_CATEGORIA = new Map([['ovo', 'ovos']]);
// Portões quase-constantes por categoria (§11.3): valores que são o DEFAULT e por
// isso NÃO devem discriminar (vaca↔null não pode partir um Mestre de leite).
const FONTE_DEFAULT = 'vaca';

const viaDic = (dic, v) => {
  const k = ln(v);
  return k ? dic.get(k) || k : '';
};

// (3) CHAVE do Mestre: tuplo canónico estável a partir das facetas (A) extraídas.
// Slots fixos; valores normalizados; `fonte=vaca` colapsa (default lácteo/bovino).
const SLOTS = ['categoria', 'apresentacao', 'corte', 'processamento', 'variedade', 'sabor', 'teor', 'estilo', 'funcao', 'fonte'];
export function chaveMestre(facetas = {}) {
  const f = facetas || {};
  let fonte = ln(f.fonte);
  if (fonte === FONTE_DEFAULT) fonte = ''; // §11.3: default não discrimina
  const v = {
    categoria: viaDic(DIC_CATEGORIA, f.categoria),
    apresentacao: ln(f.apresentacao),
    corte: ln(f.corte),
    processamento: ln(f.processamento),
    variedade: viaDic(DIC_VARIEDADE, f.variedade),
    sabor: ln(f.sabor),
    teor: viaDic(DIC_TEOR, f.teor),
    estilo: viaDic(DIC_ESTILO, f.estilo),
    funcao: ln(f.funcao),
    fonte,
  };
  return SLOTS.map((k) => v[k]).join('|');
}

export { ln };

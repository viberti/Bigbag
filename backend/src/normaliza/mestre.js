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

// Cabeçalhos de SECÇÃO da loja que o VLM às vezes cola ao nome do item seguinte
// (o Pingo Doce imprime-os em linha própria: "MERCEARIA", "TAKE-AWAY"…). Só no
// INÍCIO e só se sobrar nome a sério (≥3 chars) — lista conservadora, B5.
const SECCOES = /^(MERCEARIA(\s*\+\s*PET\s*FOOD(\s+E)?)?|CONGELADOS|TAKE[\s-]?AWAY|PET\s*FOOD|PADARIA|PASTELARIA|TALHO|PEIXARIA|CHARCUTARIA|LA[CT]TIC[IÍ]NIOS|FRUTAS\s+E\s+VEGETAIS|HIGIENE\s+E\s+BELEZA|FRESCOS|BEBIDAS)\s+(?=\S{3})/i;

// (1) LIMPEZA determinística da descrição (antes do LLM). Remove lixo estrutural:
// linha de peso colada, prefixos de quantidade, códigos de IVA, duplicações de OCR.
export function limparDescricao(d) {
  let s = String(d || '').trim();
  // Itera até estabilizar: prefixos podem empilhar ("1 1 X", "(A) 1 X").
  for (let i = 0; i < 4; i++) {
    const antes = s;
    s = s.replace(SECCOES, ''); // cabeçalho de secção colado ao nome
    s = s.replace(/\s+[A-Z]?\s*kg\s*x[\d.,]+\s+[\d.,]+\s*EUR\/kg(EUR)?/gi, ''); // "B kg x0,534 6,29 EUR/kg"
    s = s.replace(/\s+[\d.,]+\s*EUR\/kg(EUR)?/gi, '');
    s = s.replace(/kgEUR/gi, 'kg'); // duplicação de OCR
    s = s.replace(/\s+\d+,\d{1,3}\s*kg\b/gi, ''); // peso pesado "2,880 kg" (kg decimal; mantém pack "500 G")
    // Unidade SOLTA no nome ("BATATA VERMELHA KG" → vendida a kg, não é o nome).
    // Só remove se vier depois de uma LETRA (não de número) — preserva tamanho de
    // pacote "1 KG"/"500 G" e o calibre de ovo "Classe L". Não toca em "L"/"LT"/"GR"
    // (calibre de ovo · abreviatura de leite · grande/granel) — ambíguos demais.
    s = s.replace(/\s+(kgs?|litros?)\b/gi, (m, _u, off, str) =>
      /[a-z]$/i.test(str.slice(0, off).replace(/\s+$/, '')) ? '' : m,
    );
    s = s.replace(/^\(\s*[A-Z]\s*\)\s*/, ''); // código IVA no início: "(A) " "(C) "
    s = s.replace(/^\d+\s+/, ''); // prefixo de quantidade: "1 "
    s = s.replace(/^C\s+(?=[A-Z])/, ''); // "C " (código IVA) seguido de palavra
    s = s.replace(/\s+[AB]$/, ''); // sufixo de código IVA "A"/"B" (não unidades G/L)
    // "UN"/"UNI"/"UNID"/"UND" SOLTO no fim = "vendido à unidade", não é o nome
    // ("BURRATA SELEÇÃO UN" → "BURRATA SELEÇÃO"). NÃO remove se vier depois de um
    // número (pack "6 UN"/"18UN"/"1DZ" — quantidade que distingue produtos).
    s = s.replace(/\s+un(?:i|id|de|d)?\.?$/i, (m, off, str) => (/\d\s*$/.test(String(str).slice(0, off)) ? m : ''));
    s = s.replace(/\s+/g, ' ').trim();
    if (s === antes) break;
  }
  return s;
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

// Denominações de QUEIJO (ortografia → canónica). O LLM é inconsistente a colocá-las
// (ora na categoria "queijo gouda", ora só "gouda", ora perde-as) — esta camada
// determinística normaliza para categoria="queijo" + variedade=<denominação canónica>.
const QUEIJO_DENOM = new Map([
  ['mozzarella', 'mozzarella'], ['mozzarela', 'mozzarella'], ['mozarela', 'mozzarella'],
  ['gouda', 'gouda'], ['cheddar', 'cheddar'], ['edam', 'edam'], ['flamengo', 'flamengo'],
  ['emmental', 'emmental'], ['emental', 'emmental'], ['brie', 'brie'], ['camembert', 'camembert'],
  ['parmesao', 'parmesao'], ['parmigiano', 'parmesao'], ['parmigiano reggiano', 'parmesao'],
  ['grana padano', 'grana padano'], ['gruyere', 'gruyere'], ['fresco', 'fresco'], ['curado', 'curado'],
  ['manchego', 'manchego'], ['serra da estrela', 'serra da estrela'], ['ilha', 'ilha'],
  ['sao jorge', 'sao jorge'], ['gorgonzola', 'gorgonzola'], ['feta', 'feta'], ['halloumi', 'halloumi'],
]);
// Queijos com categoria PRÓPRIA (não "queijo X"): mantêm-se como categoria.
const QUEIJO_EXCECAO = new Set(['requeijao', 'burrata', 'ricotta', 'mascarpone', 'queijo creme']);

// Canonicaliza a denominação do queijo: devolve {cat,variedade} normalizados, ou
// null se não for queijo (deixa como está). "queijo gouda" / "gouda" / "queijo"+var=gouda
// → {cat:'queijo', variedade:'gouda'}. Tira " dop"/" igp" do nome. Exceções intactas.
function canonQueijo(cat, variedade) {
  if (QUEIJO_EXCECAO.has(cat)) return null;
  let denom = '';
  if (cat.startsWith('queijo ')) denom = cat.slice(7);
  else if (cat === 'queijo') denom = variedade;
  else if (QUEIJO_DENOM.has(cat)) denom = cat; // "mozzarella" sozinha
  else return null;
  denom = denom.replace(/\b(dop|igp)\b/g, '').replace(/\s+/g, ' ').trim();
  denom = QUEIJO_DENOM.get(denom) || denom;
  return { cat: 'queijo', variedade: denom };
}

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
  // Canonicalização determinística de QUEIJO (denominação consistente).
  const cq = canonQueijo(v.categoria, v.variedade);
  if (cq) {
    v.categoria = cq.cat;
    v.variedade = cq.variedade;
  }
  return SLOTS.map((k) => v[k]).join('|');
}

export { ln };

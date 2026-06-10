// Camada 2 — canonicalização por LLM. Dada uma descrição de talão, devolve o
// produto canónico SEM marca/formato no nome (o nome é a "classe": é o que
// agrupa o mesmo produto entre lojas), mais marca/categoria/unidade à parte.
// Texto-only (barato). Isolado para ser injetável/stubável nos testes.
import { chatCompletion } from '../openrouter.js';
import { expansoesPara } from './abreviaturas.js';

const PROMPT = `És um normalizador de produtos de supermercado português.
Dada a descrição de um item de talão (com abreviaturas e, às vezes, erros de
leitura/OCR), devolve SÓ um objeto JSON:
{
  "nome_canonico": string,   // o produto SEM marca e SEM formato/peso, legível e genérico.
                             // ex.: "BOL DIGESTIVE AVEIA CNT 425GR" -> "Bolacha Digestive de Aveia"
                             //      "MANTEIGA C/ SAL CONTINENTE 250G" -> "Manteiga com Sal"
                             //      "BANANA 1,800 kg" -> "Banana"
  "marca": string|null,      // marca comercial se identificável (Mimosa, Heinz, Continente, Lidl...), senão null
  "categoria": string,       // ex.: "Laticínios", "Mercearia Doce", "Frutas e Legumes", "Talho"
  "unidade_base": "un"|"kg"|"L",  // a unidade NATURAL de comparação (ver regra abaixo)
  "confianca": number        // 0..1 — baixa se a descrição for ambígua/ilegível
}
Regras:
- unidade_base = a unidade em que o produto se COMPARA, não a embalagem:
    * "kg" para o que se vende/pesa a PESO: café, queijo, fiambre/charcutaria, carne,
      peixe, manteiga, arroz, massa, açúcar, frutas e legumes a granel.
    * "L" para LÍQUIDOS: leite, sumo, refrigerante, azeite, óleo, água, natas, cerveja, vinho.
    * "un" SÓ para o que é genuinamente CONTADO à unidade: ovos, iogurtes, latas,
      pacotes de bolachas, escovas, sabonetes.
  Na dúvida entre "un" e peso para um sólido que se vende por peso (ex.: café 250g,
  queijo 200g), escolhe SEMPRE "kg" — assim compara-se €/kg entre formatos diferentes.
- Expande abreviaturas comuns: BOL=Bolacha, QJ=Queijo, IOG=Iogurte, C/=com, S/=sem,
  SAB=Sabonete, DET=Detergente, CHAMP=Champô, DIG=Digestive, INT/INTEG=Integral,
  NAT=Natural, M/G ou MG (em laticínios)=Meio-Gordo, MAGRO/MG (light)=Magro,
  EMB=Embalado, CONG=Congelado, FRESC=Fresco. (Ambiguidades resolve-as pelo contexto.)
- Os marcadores de CADEIA no nome (CNT/CONT=Continente, PD=Pingo Doce, MIN/M.PRECO=Minipreço,
  AUCH=Auchan) NÃO entram no nome_canonico — se forem a insígnia do produto, vão para a "marca".
- NÃO transformes produtos de HIGIENE/BELEZA/LIMPEZA em alimentos: "SAB." é Sabonete (não "Arroz"); palavras como sabonete, champô, gel, creme, serum, detergente, lixívia, amaciador indicam que NÃO é comida — mantém a categoria certa.
- Ignora quantidade/código no início ("1 ", "2 ", "Uni ", "I ") — não faz parte do nome.
- CORRIGE erros óbvios de leitura para o produto real que de facto existe, usando
  o teu conhecimento de produtos de supermercado portugueses:
    "OLO GIRASSOL" -> "Óleo de Girassol"   (faltou uma letra)
    "RUPA TOMATE"  -> "Polpa de Tomate"
    "MANTEEA"      -> "Manteiga"            (letras trocadas)
  e usa essa correção também na "marca" quando aplicável.
- MAS nunca inventes: se a descrição for ilegível ou ambígua e não houver um produto
  claro que encaixe, mantém-na o mais fiel possível e baixa a "confianca" (≤ 0.5).
- Se a descrição NÃO contiver nenhuma palavra de produto — só números, pesos, unidades
  ou preços (ex.: "2,426 kg 1,29 EUR/kg") — NÃO adivinhes um produto: devolve
  nome_canonico "(desconhecido)" e "confianca" 0.
- NUNCA incluas no nome números, preços, pesos ou códigos.
O nome_canonico NUNCA inclui a marca nem o formato/peso. Dois produtos iguais de
marcas diferentes partilham o mesmo nome_canonico (distinguem-se pela marca).`;

function parseJson(txt) {
  let s = String(txt).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

// Juiz da zona cinzenta (Camada 3): dois nomes parecidos são o MESMO produto?
export async function confirmarMesmoProduto(nomeA, nomeB, { model, timeoutMs } = {}) {
  const txt = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: `Dois nomes de produto de supermercado. São o MESMO produto (ignorando diferenças de escrita/qualificadores)? Responde SÓ JSON {"mesmo": true|false}.\nA: ${nomeA}\nB: ${nomeB}`,
      },
    ],
    model,
    timeoutMs,
    responseFormat: { type: 'json_object' },
    contexto: 'confirmar',
  });
  try {
    return parseJson(txt).mesmo === true;
  } catch {
    return false;
  }
}

export async function canonicalizar(descricao, { model, timeoutMs, cadeia, pistaCatalogo, marcaDetetada } = {}) {
  // Contexto da loja: o modelo desambigua muito melhor abreviaturas/marcas quando
  // sabe que cadeia gerou o talão (ex.: insígnias e estilos próprios do Lidl vs Continente).
  const ctx = cadeia ? `\nContexto: este item vem de um talão do(a) ${cadeia} — usa as abreviaturas e marcas próprias dessa cadeia para desambiguar.` : '';
  // Pistas DIRIGIDAS do dicionário de abreviaturas (curadas + minadas dos pares
  // validados): só as presentes NESTA descrição — ancoram o LLM e reduzem variantes.
  const exps = expansoesPara(descricao);
  let pistas = exps.length
    ? `\nPistas (dicionário aprendido das identificações reais): ${exps.map((e) => `${e.abrev}=${e.expansao}`).join(', ')}.`
    : '';
  // Pista do MOTOR DE BUSCA interno (A2): o produto real provável no catálogo da
  // loja — ancora a expansão das abreviaturas no produto que de facto existe.
  if (pistaCatalogo?.nome) {
    pistas += `\nProduto PROVÁVEL no catálogo (match determinístico do nome do talão): "${pistaCatalogo.nome}"${pistaCatalogo.marca ? ` (marca ${pistaCatalogo.marca})` : ''}. Se a descrição encaixar neste produto, usa-o para expandir o nome — mas o nome_canonico continua SEM marca e SEM formato; se NÃO encaixar, ignora a pista.`;
  }
  if (marcaDetetada) {
    pistas += `\nMarca DETETADA deterministicamente no nome do talão: "${marcaDetetada}" — usa exatamente esta no campo "marca" (e não a incluas no nome_canonico).`;
  }
  const pedir = () =>
    chatCompletion({
      messages: [{ role: 'user', content: `${PROMPT}${ctx}${pistas}\n\nDescrição: ${descricao}` }],
      model,
      timeoutMs,
      responseFormat: { type: 'json_object' },
      contexto: 'canonicalizar',
    });
  let c;
  try {
    c = parseJson(await pedir());
  } catch {
    c = parseJson(await pedir()); // uma nova tentativa em caso de JSON malformado
  }
  if (!c || !c.nome_canonico) throw new Error('Canonicalização sem nome_canonico');
  return {
    nome_canonico: String(c.nome_canonico).trim(),
    marca: c.marca ? String(c.marca).trim() : null,
    categoria: c.categoria ? String(c.categoria).trim() : null,
    unidade_base: ['un', 'kg', 'L'].includes(c.unidade_base) ? c.unidade_base : 'un',
    confianca: typeof c.confianca === 'number' ? c.confianca : 0.5,
  };
}

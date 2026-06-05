// Camada 2 — canonicalização por LLM. Dada uma descrição de talão, devolve o
// produto canónico SEM marca/formato no nome (o nome é a "classe": é o que
// agrupa o mesmo produto entre lojas), mais marca/categoria/unidade à parte.
// Texto-only (barato). Isolado para ser injetável/stubável nos testes.
import { chatCompletion } from '../openrouter.js';

const PROMPT = `És um normalizador de produtos de supermercado português.
Dada a descrição de um item de talão (com abreviaturas), devolve SÓ um objeto JSON:
{
  "nome_canonico": string,   // o produto SEM marca e SEM formato/peso, legível e genérico.
                             // ex.: "BOL DIGESTIVE AVEIA CNT 425GR" -> "Bolacha Digestive de Aveia"
                             //      "MANTEIGA C/ SAL CONTINENTE 250G" -> "Manteiga com Sal"
                             //      "BANANA 1,800 kg" -> "Banana"
  "marca": string|null,      // marca comercial se identificável (Mimosa, Heinz, Continente, Lidl...), senão null
  "categoria": string,       // ex.: "Laticínios", "Mercearia Doce", "Frutas e Legumes", "Talho"
  "unidade_base": "un"|"kg"|"L",
  "confianca": number        // 0..1 — baixa se a descrição for ambígua/ilegível
}
Regras: expande abreviaturas (BOL=Bolacha, QJ=Queijo, IOG=Iogurte, C/=com, S/=sem).
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

export async function canonicalizar(descricao, { model, timeoutMs } = {}) {
  const pedir = () =>
    chatCompletion({
      messages: [{ role: 'user', content: `${PROMPT}\n\nDescrição: ${descricao}` }],
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

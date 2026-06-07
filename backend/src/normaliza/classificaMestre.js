// Classifica uma descrição de talão no Produto Mestre: limpeza determinística →
// extração de facetas (LLM, categoria FINA + portões da categoria) → chave canónica
// determinística (mestre.js). O LLM só extrai; a chave estável é construída em código.
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';
import { parseJsonLoose } from '../ingest/extract.js';
import { limparDescricao, chaveMestre, ln } from './mestre.js';

const PROMPT = `És um classificador de produtos de supermercado português. Dá a CATEGORIA MAIS FINA (o produto específico) e os PORTÕES que distinguem produtos dentro dela. Devolve SÓ JSON; null quando NÃO se infere (não adivinhes):
{
  "categoria": string,         // FINA. Inclui o TIPO que distingue o produto:
                               //   café -> "café" ou "café descafeinado";
                               //   chocolate -> "chocolate negro" / "chocolate de leite" / "chocolate branco".
                               //   arroz -> só "arroz" (a variedade vai no slot "variedade", ver regras).
                               //   NUNCA classes largas: "fruta","carne","cereais","vegetal","laticinio".
  "apresentacao": string|null, // inteiro · fatiado · ralado · pedaco · cortado
  "corte": string|null,        // (carne) peito · lombinho · coxa · perna · bife
  "processamento": string|null,// inteiro · moida · preparado · desidratado/seco
  "variedade": string|null,    // (fruta/legume/arroz) gala · golden · carolino  (ROYAL GALA->gala)
  "sabor": string|null,        // natural · coco · morango
  "teor": string|null,         // gordo · meio-gordo · magro  (M/G->meio-gordo; MG(leite)->meio-gordo; MAGRO/0%/LIGEIRO->magro)
  "estilo": string|null,       // (iogurte) grego · skyr
  "funcao": string|null,       // (higiene) branqueador · gengivas · multi
  "fonte": string|null         // (queijo/leite/requeijão) vaca · cabra · ovelha
}
Regras:
- Fruta/legume DESIDRATADO ou SECO -> processamento="desidratado" (banana fresca != banana desidratada).
- QUEIJO: categoria = o queijo ESPECÍFICO (ex.: "queijo flamengo", "queijo mozzarella", "queijo gouda", "queijo cheddar", "queijo edam", "queijo fresco", "requeijão", "queijo creme", "queijo da ilha", "queijo serra da estrela") — NUNCA só "queijo". APRESENTAÇÃO (fatiado · ralado · bola/inteiro · barra · porções) -> "apresentacao"; FONTE (cabra · ovelha · búfala; vaca=default) -> "fonte"; CURA (fresco · amanteigado · curado) -> "processamento".
- ARROZ: categoria="arroz". A VARIEDADE (agulha · carolino · basmati · thai/jasmim · arbóreo/risotto · selvagem · sushi) vai em "variedade"; a REFINAÇÃO (integral · vaporizado) em "processamento". Se a variedade NÃO for clara, variedade=null (NÃO assumas "agulha"). "Arroz pronto a cozer/comer" e "folha de arroz" NÃO são arroz cru -> usa outra categoria (ex.: "refeição de arroz", "folha de arroz").
- CÉTICO: dá a categoria REAL do produto; NÃO o encaixes por associação de palavras numa categoria a que não pertence. Ex.: DVD/filme "As Galinhas" NÃO é "ovos"; "Máscara Facial" NÃO é "champô"; "Detergente" NÃO é "filtro de café". Se não for produto de supermercado/mercearia/casa, ou não tiveres a categoria real com confiança -> categoria=null.
MARCA, FORMATO e QUANTIDADE não entram. Só o JSON.`;

// Modelo: provámos que, com a chave canónica, o modelo quase não importa; usa o
// flash (bom/barato). Trocável por env se preciso.
const MODELO = process.env.OPENROUTER_MODEL_MESTRE || 'google/gemini-2.5-flash';

export async function extrairFacetasMestre(descricao, { model, timeoutMs } = {}) {
  const bruto = await chatCompletion({
    messages: [{ role: 'user', content: `${PROMPT}\n\nDescrição: ${descricao}` }],
    model: model || MODELO,
    timeoutMs,
    responseFormat: { type: 'json_object' },
    contexto: 'mestre',
  });
  const f = parseJsonLoose(bruto);
  if (!f || typeof f !== 'object') throw new Error('facetas-mestre inválidas');
  return f;
}

// descrição → { limpa, facetas, chave, categoria }
export async function classificarMestre(descricao, opts = {}) {
  const limpa = limparDescricao(descricao);
  const facetas = await extrairFacetasMestre(limpa, opts);
  return { limpa, facetas, chave: chaveMestre(facetas), categoria: ln(facetas?.categoria) };
}

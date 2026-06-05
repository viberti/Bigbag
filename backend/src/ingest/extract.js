// Extração de fatura por VLM direto (Abordagem A). Manda a imagem ao modelo
// multimodal e pede JSON estruturado. (Abordagem B — OCR+LLM — entra depois,
// trocável, para comparar; metodo_extracao na fatura regista qual gerou cada
// registo.)
import { visionPrompt, chatCompletion } from '../openrouter.js';
import { normalizarItens } from './normalize.js';

const PROMPT = `És um extrator de faturas de supermercado português (Continente, Pingo Doce, Mercadona, Aldi, Lidl).
Lê a imagem da fatura (talão térmico, pode estar amassado) e devolve SÓ um objeto JSON, sem texto à volta, sem markdown.

Esquema exato:
{
  "loja": { "cadeia": string, "nome": string, "nif": string|null, "localizacao": string|null },
  "numero_fatura": string|null,     // nº do documento fiscal após "Nro:"/"No :" (ex. "FS ARQ214/141059"); null se ilegível
  "data_compra": string,            // ISO 8601, ex. "2026-05-22T18:02:00"
  "subtotal": number|null,          // SUBTOTAL antes do desconto global
  "desconto_global": number,        // ex. "Desconto Cartão Utilizado"; 0 se não houver
  "total_impresso": number,         // "TOTAL A PAGAR"
  "itens": [
    {
      "descricao_original": string, // verbatim, como impresso (ex. "BOL DIGESTIVE AVEIA CNT 425GR")
      "valor": number,              // preço impresso nessa linha
      "iva": string|null,           // letra do escalão IVA se visível (A/B/C), senão null
      "desconto_direto": number,    // "Poupança" impressa SOB este item; 0 se não houver
      "is_clearance": boolean,      // true se a linha "Aprox. fim prazo validade" estiver associada a este item
      "is_non_product": boolean     // true para saco, taxa, depósito — não é produto
    }
  ]
}

Regras:
- O NIF da LOJA é o do estabelecimento/vendedor (perto do nome no topo), NÃO o NIF do cliente.
- "Aprox. fim prazo validade" aparece NA LINHA ABAIXO do produto — associa ao item imediatamente acima (is_clearance=true).
- Linhas de desconto sob um produto ("Poupança", "Promoção", "Promoção Lidl Plus", "Desconto") pertencem a esse produto: soma a magnitude (positiva) no desconto_direto desse item. NUNCA cries um item separado para um desconto. O "valor" do item é o preço impresso na linha do produto (tal como aparece, mesmo que haja desconto por baixo).
- Itens a peso aparecem como "0,505 kg x 6,19 EUR/kg" → o "valor" é o PREÇO IMPRESSO na linha do produto (a coluna de preço, à direita do nome), e NÃO o resultado de kg × €/kg, que pode diferir por arredondamento. Ex.: se a linha do produto diz 2,29 € e por baixo "0,618 kg x 3,59 €/kg", o valor é 2,29 (não 2,22).
- Não inventes itens nem valores. Se um valor não for legível, usa null no campo numérico desse item e mantém a descrição.
- Ignora a numeração de cabeçalho/rodapé; extrai só as linhas de produto e os totais.
- IGNORA o rodapé de fidelização/cartão: "ACUMULOU NO SEU CARTAO", "DESCONTO CUPAO", "SALDO NO CARTAO", "Saldo de selos", "Selos ganhos", "Já ganhou com o cartão", cupões lidos/emitidos, pontos. NÃO são itens nem descontos desta compra — não os contes em desconto_global nem em desconto_direto.`;

function parseJsonLoose(txt) {
  let s = String(txt).trim();
  // remove cercas de código se vierem
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // recorta do primeiro { ao último }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function extrairFatura({ imageBase64, mime, model, timeoutMs }) {
  const bruto = await visionPrompt({
    prompt: PROMPT,
    imageBase64,
    mime,
    model,
    timeoutMs,
    responseFormat: { type: 'json_object' },
  });
  const dados = parseJsonLoose(bruto);
  if (!dados || !Array.isArray(dados.itens)) {
    throw new Error('Extração VLM não devolveu itens válidos');
  }
  dados.itens = normalizarItens(dados.itens);
  return dados;
}

// Abordagem B — OCR/texto + LLM. Para faturas digitais em PDF (texto já
// extraído). Mesmo esquema/regras; só muda a entrada (texto em vez de imagem).
export async function extrairFaturaDeTexto(texto, { model, timeoutMs } = {}) {
  const bruto = await chatCompletion({
    messages: [
      { role: 'user', content: `${PROMPT}\n\nEis o TEXTO de uma fatura (já extraído do PDF):\n"""\n${texto}\n"""` },
    ],
    model,
    timeoutMs,
    responseFormat: { type: 'json_object' },
  });
  const dados = parseJsonLoose(bruto);
  if (!dados || !Array.isArray(dados.itens)) {
    throw new Error('Extração (texto) não devolveu itens válidos');
  }
  dados.itens = normalizarItens(dados.itens);
  return dados;
}

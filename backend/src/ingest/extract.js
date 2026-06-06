// Extração de fatura por VLM direto (Abordagem A). Manda a imagem ao modelo
// multimodal e pede JSON estruturado. (Abordagem B — OCR+LLM — entra depois,
// trocável, para comparar; metodo_extracao na fatura regista qual gerou cada
// registo.)
import { visionPrompt, chatCompletion } from '../openrouter.js';
import { normalizarItens } from './normalize.js';
import { config } from '../config.js';

const PROMPT = `És um extrator de faturas de supermercado português (Continente, Pingo Doce, Mercadona, Aldi, Lidl).
Lê a imagem da fatura (talão térmico, pode estar amassado) e devolve SÓ um objeto JSON, sem texto à volta, sem markdown.

Esquema exato:
{
  "loja": { "cadeia": string, "nome": string, "nif": string|null, "localizacao": string|null }, // localizacao = endereço da LOJA física (topo, logo abaixo da marca), NÃO o da sede fiscal

  "numero_fatura": string|null,     // nº do documento fiscal após "Nro:"/"No :" (ex. "FS ARQ214/141059"); null se ilegível
  "data_compra": string,            // ISO 8601, ex. "2026-05-22T18:02:00"
  "subtotal": number|null,          // SUBTOTAL antes do desconto global
  "desconto_global": number,        // ex. "Desconto Cartão Utilizado"; 0 se não houver
  "iva": number,                    // IVA ADICIONADO no fim: 0 nos talões normais (o preço já inclui IVA); >0 SÓ em cash-and-carry/grossista (ex. Makro), onde os preços das linhas são SEM IVA e o IVA é somado até ao total
  "total_impresso": number,         // "TOTAL A PAGAR" / "Valor Total" (o valor final pago)
  "itens": [
    {
      "descricao_original": string, // verbatim, como impresso (ex. "BOL DIGESTIVE AVEIA CNT 425GR")
      "quantidade": number,         // unidades faturadas nesta linha: "24 OVOS"→24, "6 IOGURTES"→6; 1 se não indicado. Item a peso → 1 (o peso vem do formato).
      "preco_unitario": number|null,// preço POR UNIDADE quando a linha o mostra explicitamente: "2 X 0,59"→0,59; coluna "Preço U.V." do grossista. null se não houver multiplicador (compra de 1). NUNCA pôr aqui o total da linha.
      "valor": number,              // TOTAL impresso nessa linha (a coluna à direita). Em "2 X 0,59 … 1,18" o valor é 1,18, NÃO 0,59.
      "taxa_iva": number|null,      // TAXA de IVA deste produto em DECIMAL (0.06, 0.13, 0.23). Resolve-a pelo código no fim da linha + a legenda no corpo da fatura (ver regra). null se não der.
      "desconto_direto": number,    // "Poupança" impressa SOB este item; 0 se não houver
      "is_clearance": boolean,      // true se a linha "Aprox. fim prazo validade" estiver associada a este item
      "is_non_product": boolean     // true para saco, taxa, depósito — não é produto
    }
  ]
}

Regras:
- O NIF da LOJA é o do estabelecimento/vendedor (perto do nome no topo), NÃO o NIF do cliente.
- ENDEREÇO DA LOJA (localizacao): muitos talões têm DOIS endereços. Usa SEMPRE o da LOJA física — o que aparece no TOPO, logo abaixo do nome da marca (ex. na Mercadona: "AV. ANTÓNIO PALHA, 5 …"). NÃO uses o endereço da sociedade/sede fiscal, que aparece mais abaixo, junto ao NIF/"Capital Social"/"S.A."/"Unipessoal, Lda" (ex. "Av. Padre Jorge Duarte 123") — esse é o da empresa, não o da loja.
- "Aprox. fim prazo validade" aparece NA LINHA ABAIXO do produto — associa ao item imediatamente acima (is_clearance=true).
- Linhas de desconto sob um produto ("Poupança", "Promoção", "Promoção Lidl Plus", "Desconto") pertencem a esse produto: soma a magnitude (positiva) no desconto_direto desse item. NUNCA cries um item separado para um desconto. O "valor" do item é o preço impresso na linha do produto (tal como aparece, mesmo que haja desconto por baixo).
- desconto_global é SÓ a linha de desconto que reduz o SUBTOTAL até ao TOTAL A PAGAR — tipicamente "Desconto Cartão Utilizado"/"Desconto Cartão" (Continente). NÃO contes aqui as poupanças por linha (já vão no desconto_direto do item) NEM a linha-resumo "Total de descontos e poupanças" (é só o somatório das poupanças, informativo) — senão o desconto fica contado a dobrar e o total não fecha. Regra de verificação: SUBTOTAL − desconto_global deve dar o TOTAL A PAGAR; se não der, o desconto_global está errado (provavelmente devia ser 0).
- Itens a peso aparecem como "0,505 kg x 6,19 EUR/kg" → o "valor" é o PREÇO IMPRESSO na linha do produto (a coluna de preço, à direita do nome), e NÃO o resultado de kg × €/kg, que pode diferir por arredondamento. Ex.: se a linha do produto diz 2,29 € e por baixo "0,618 kg x 3,59 €/kg", o valor é 2,29 (não 2,22).
- ITEM A PESO EM DUAS LINHAS (comum na Mercadona): o NOME do produto está numa linha e "X,XXX kg  Y,YY EUR/kg" na linha SEGUINTE — são o MESMO item, não dois. Junta-os: a "descricao_original" deve conter o NOME seguido do peso (ex. "BANANA 2,426 kg 1,20 EUR/kg") e o "valor" é o total impresso à direita (na linha do peso). NUNCA emitas um item cuja descrição seja só "X kg … EUR/kg" sem nome de produto.
- MULTIPACK "N X preço": quando a linha mostra "2 X 0,59" (N unidades ao preço unitário, comum no Continente), o "valor" do item é o TOTAL da linha (a coluna à direita, ex.: 1,18 = 2×0,59) e a "quantidade" é N. NUNCA uses o preço unitário (0,59) sozinho como valor.
- CONTEÚDO DO PACK no NOME ("6*", "4*200", "PACK 18", "1LT*6", "2KG") ≠ quantidade comprada. É o que vem DENTRO da embalagem. Se compraste UMA embalagem, quantidade=1 e preco_unitario=null. Só uma linha de MULTIPLICADOR EXPLÍCITO ("N X preço") ou a coluna "Quant" do grossista significa N embalagens compradas. Ex.: "SUMO … 6* … 2,49" → quantidade=1, valor=2,49 (NÃO quantidade=6).
- COLUNA DE QUANTIDADE (grossistas como o Makro têm uma coluna "Quant"/"Quantidade"): LÊ-A SEMPRE. O "valor" é o TOTAL da linha ("Valor total") e a "quantidade" é o que está na coluna Quant. Ex.: "PASSATA … Preço U.V. 2,59 … Quant 3 … Valor total 7,77" → quantidade=3, valor=7,77. NUNCA deixes "quantidade" a null — se não houver coluna nem indicação, é 1.
- IVA EM GROSSISTAS (cash-and-carry, ex. Makro): nesses talões os preços das linhas são SEM IVA; aparece um "Total s/IVA" (= soma das linhas) e o IVA é somado a seguir até ao "Valor Total". Põe o IVA somado no campo "iva" (ex.: 7,77) e o "Valor Total" em total_impresso. Em talões NORMAIS de supermercado o preço JÁ inclui IVA → iva = 0 (a tabela de IVA no rodapé é só informativa, não a somes). Verificação: Σ valores das linhas − desconto_global + iva = total_impresso.
- TAXA DE IVA POR PRODUTO ("taxa_iva"): cada linha de produto traz, no FIM, um código/letra do escalão de IVA — ex.: Continente "(A)"/"(C)", Mercadona uma letra "A"/"B"/"C", Aldi um número "1"/"2"/"3", Lidl "A"/"B", Makro "2"/"4". No CORPO/rodapé da fatura há uma LEGENDA/tabela de IVA que diz a que TAXA corresponde cada código (6%, 13% ou 23%). Para CADA item, devolve "taxa_iva" = essa taxa em DECIMAL (6%→0.06, 13%→0.13, 23%→0.23), mapeando o código da linha pela legenda. Em Portugal: alimentos básicos (leite, pão, fruta, legumes, ovos) costumam ser 6%; alguns intermédios 13%; não-alimentar 23%. Se não conseguires mapear o código com segurança, usa null (NÃO inventes a taxa).
- Extrai TODOS os produtos — NÃO saltes nenhuma linha de produto, mesmo que a imagem esteja pouco nítida.
- Não inventes itens nem valores. Se um valor não for legível, usa null no campo numérico desse item e mantém a descrição.
- Ignora a numeração de cabeçalho/rodapé; extrai só as linhas de produto e os totais.
- IGNORA o rodapé de fidelização/cartão: "ACUMULOU NO SEU CARTAO", "DESCONTO CUPAO", "SALDO NO CARTAO", "Saldo de selos", "Selos ganhos", "Já ganhou com o cartão", cupões lidos/emitidos, pontos. NÃO são itens nem descontos desta compra — não os contes em desconto_global nem em desconto_direto.`;

// Reexportado para o harness de comparação (head-to-head) usar EXATAMENTE o
// mesmo prompt/parser que a ingestão real — comparação justa.
export const PROMPT_EXTRACAO = PROMPT;

export function parseJsonLoose(txt) {
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

export async function extrairFatura({ imageBase64, mime, model, timeoutMs, correcao }) {
  const prompt = correcao ? `${PROMPT}\n\nATENÇÃO — a tua extração anterior não fechou. ${correcao}` : PROMPT;
  const pedir = () =>
    visionPrompt({
      prompt,
      imageBase64,
      mime,
      model: model || config.openrouter.modelExtracao, // imagem → modelo forte
      timeoutMs,
      responseFormat: { type: 'json_object' },
      contexto: 'extracao_imagem',
    });
  let dados;
  try {
    dados = parseJsonLoose(await pedir());
  } catch {
    dados = parseJsonLoose(await pedir()); // nova tentativa em caso de JSON malformado
  }
  if (!dados || !Array.isArray(dados.itens)) {
    throw new Error('Extração VLM não devolveu itens válidos');
  }
  dados.itens = normalizarItens(dados.itens);
  return dados;
}

// Abordagem B — OCR/texto + LLM. Para faturas digitais em PDF (texto já
// extraído). Mesmo esquema/regras; só muda a entrada (texto em vez de imagem).
export async function extrairFaturaDeTexto(texto, { model, timeoutMs, correcao } = {}) {
  const atencao = correcao ? `\n\nATENÇÃO — a tua extração anterior não fechou. ${correcao}` : '';
  const bruto = await chatCompletion({
    messages: [
      { role: 'user', content: `${PROMPT}${atencao}\n\nEis o TEXTO de uma fatura (já extraído do PDF):\n"""\n${texto}\n"""` },
    ],
    model,
    timeoutMs,
    responseFormat: { type: 'json_object' },
    contexto: 'extracao_texto',
  });
  const dados = parseJsonLoose(bruto);
  if (!dados || !Array.isArray(dados.itens)) {
    throw new Error('Extração (texto) não devolveu itens válidos');
  }
  dados.itens = normalizarItens(dados.itens);
  return dados;
}

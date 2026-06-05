// Contrato de tool use para o LLM (formato OpenRouter/OpenAI) + dispatcher.
// O schema é verbatim de docs/Schema_e_Funcoes_ToolUse.md. O LLM escolhe a
// função; o backend executa a query (queries.js) e devolve JSON; o LLM
// formula a resposta em português.
import * as queries from './queries.js';

export const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'buscar_ultima_compra',
      description:
        'Devolve a compra mais recente de um produto: preço pago, loja e data. Usar quando o utilizador pergunta quanto pagou ou onde comprou um produto da última vez.',
      parameters: {
        type: 'object',
        properties: {
          produto: {
            type: 'string',
            description:
              "Nome do produto em linguagem natural, ex. 'manteiga', 'leite meio-gordo'. O backend faz a correspondência ao SKU canónico.",
          },
        },
        required: ['produto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'comparar_precos_por_loja',
      description:
        "Compara o preço de um produto entre as várias lojas, do mais barato ao mais caro, usando o preço por unidade-base (€/kg, €/L ou €/un). Usar para perguntas do tipo 'onde está mais barato'. Exclui itens em fim de validade.",
      parameters: {
        type: 'object',
        properties: {
          produto: { type: 'string', description: 'Nome do produto em linguagem natural.' },
        },
        required: ['produto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'historico_preco',
      description:
        "Devolve a evolução do preço de um produto ao longo do tempo (lista de preço por data e loja). Usar para perguntas sobre subida/descida de preço ou 'quanto custava antes'.",
      parameters: {
        type: 'object',
        properties: {
          produto: { type: 'string', description: 'Nome do produto em linguagem natural.' },
          desde: {
            type: 'string',
            description:
              "Data inicial opcional, formato ISO 'YYYY-MM-DD'. Se omitida, todo o histórico.",
          },
        },
        required: ['produto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_compras',
      description:
        "Lista o que foi comprado num período (cada item com data, loja e preço pago). Usar para 'o que comprei em maio', 'mostra as minhas compras da semana passada', 'o que levei no Continente'. Pode filtrar por produto/categoria.",
      parameters: {
        type: 'object',
        properties: {
          periodo_inicio: { type: 'string', description: "Data inicial ISO 'YYYY-MM-DD'." },
          periodo_fim: { type: 'string', description: "Data final ISO 'YYYY-MM-DD'. Se omitida, até hoje." },
          alvo: {
            type: 'string',
            description: "Opcional: produto ('café') ou categoria ('Laticínios') para filtrar. Omitir para tudo.",
          },
        },
        required: ['periodo_inicio'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'total_gasto',
      description:
        "Soma quanto foi gasto num produto, categoria, ou no total, num período. Usar para 'quanto gastei em X este mês/ano'.",
      parameters: {
        type: 'object',
        properties: {
          alvo: {
            type: 'string',
            description: "Produto ('café'), categoria ('Laticínios'), ou 'tudo' para o total geral.",
          },
          periodo_inicio: { type: 'string', description: "Data inicial ISO 'YYYY-MM-DD'." },
          periodo_fim: {
            type: 'string',
            description: "Data final ISO 'YYYY-MM-DD'. Se omitida, até hoje.",
          },
        },
        required: ['alvo', 'periodo_inicio'],
      },
    },
  },
];

// Mapa nome → função de queries.js. O LLM nunca toca na BD diretamente.
const dispatch = {
  buscar_ultima_compra: queries.buscar_ultima_compra,
  comparar_precos_por_loja: queries.comparar_precos_por_loja,
  historico_preco: queries.historico_preco,
  total_gasto: queries.total_gasto,
  listar_compras: queries.listar_compras,
};

// Executa uma tool call do LLM. `args` é o objeto de argumentos já parseado.
export async function executarTool(db, nome, args) {
  const fn = dispatch[nome];
  if (!fn) throw new Error(`Tool desconhecida: ${nome}`);
  return fn(db, args ?? {});
}

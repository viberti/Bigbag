// Consulta por texto (o foco do laboratório, antes da voz).
// Fluxo: pergunta → o LLM escolhe ferramenta(s) (tool use) → o backend executa
// a query → o LLM formula a resposta em português. Sem slot-filling.
// `chat` é injetável (testes usam stub; produção usa OpenRouter).
import { chatCompletionFull } from './openrouter.js';
import { toolDefs, executarTool } from './tools.js';
import { getPool } from './db.js';

function systemPrompt(hoje) {
  return `És o assistente do Bigbag, um histórico pessoal de preços de compras de supermercado.
Respondes em português europeu, de forma curta, natural e direta.
Tens ferramentas para consultar a base de dados — USA-AS para responder com dados reais.
NUNCA inventes preços, datas, lojas ou produtos: se a ferramenta não devolver dados, diz que não há registo.
Hoje é ${hoje}. Converte períodos relativos ("este mês", "a semana passada") para datas ISO (YYYY-MM-DD) antes de chamar as ferramentas.
Se for indicado um MÊS SEM ANO (ex. "maio", "em março"), assume SEMPRE o ano atual — NUNCA peças o ano. Ex.: "maio" → de ${hoje.slice(0, 4)}-05-01 a ${hoje.slice(0, 4)}-05-31.
Se NÃO for indicado período nenhum (ex. "quanto gastei em vinho", "quanto gastei no Lidl"), assume TODO o histórico — NÃO peças o período, chama logo a ferramenta (sem periodo_inicio).
Se a pergunta referir uma loja (ex. "no Lidl"), passa-a no parâmetro 'loja'. NUNCA peças loja nem período: na dúvida, abrange tudo.
Quando o utilizador pede para VER/MOSTRAR/LISTAR o que comprou, usa listar_compras e ENUMERA de facto os itens (não te limites a contar ou somar).
Formata preços em euros com vírgula (ex.: 2,19 €). Sê conciso, mas lista quando for pedido.`;
}

export async function responderPergunta(pergunta, { db = getPool(), chat = chatCompletionFull, hoje, maxRondas = 5 } = {}) {
  const dataHoje = hoje || new Date().toISOString().slice(0, 10);
  const messages = [
    { role: 'system', content: systemPrompt(dataHoje) },
    { role: 'user', content: String(pergunta || '') },
  ];
  const chamadas = [];

  for (let ronda = 0; ronda < maxRondas; ronda++) {
    const msg = await chat({ messages, tools: toolDefs });
    messages.push(msg);

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      return { resposta: msg.content || '', chamadas };
    }

    for (const tc of toolCalls) {
      const nome = tc.function?.name;
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        args = {};
      }
      let resultado;
      try {
        resultado = await executarTool(db, nome, args);
      } catch (e) {
        resultado = { erro: e.message };
      }
      chamadas.push({ nome, args, resultado });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultado) });
    }
  }
  return { resposta: 'Não consegui responder a essa pergunta.', chamadas };
}

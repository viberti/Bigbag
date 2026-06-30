// AUDITOR de nutrição por LLM (qualidade de dados, 2026-06-30): a análise que PRECEDE a revisão
// humana. Os sinais determinísticos (Atwater A, envelope C2, consenso C3, sal=0 em família salgada)
// dizem "isto é SUSPEITO" mas não sabem o valor certo; o LLM, com conhecimento da composição típica
// dos alimentos, julga se a nutrição é plausível PARA AQUELE produto e aponta o campo provavelmente
// errado + o valor típico. Triagem: 'ok' sai da fila; 'erro'/'incerto' vão ao humano (já com a análise).
// NÃO altera dados — só analisa. Conservador: só marca 'erro' em discrepância clara.
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';

const PROMPT = `És um auditor de dados nutricionais de supermercado. Recebes o NOME de um produto, a sua FAMÍLIA, e a NUTRIÇÃO declarada por 100 g/ml. Com base no teu conhecimento da composição TÍPICA desse alimento, avalia se os valores são PLAUSÍVEIS.
Foca-te em ERROS GROSSEIROS: um valor muito fora do esperado para o produto, ou um campo provavelmente EM FALTA guardado como 0 (ex.: um queijo curado com sal=0 — queijo é salgado; o sal está em falta, não é zero).
Sê CONSERVADOR: marca "erro" só com discrepância clara; se for plausível, "ok"; se não tiveres a certeza, "incerto". NÃO inventes precisão.
Responde SÓ com JSON:
{"veredicto":"ok|erro|incerto","campos_suspeitos":[{"campo":"sal","valor":0,"valor_tipico":1.8,"motivo":"queijo curado tem ~1,8 g de sal"}],"confianca":0.0-1.0,"resumo":"frase curta"}`;

// Audita uma nutrição. Devolve o veredicto (objeto) ou null se o LLM falhar.
export async function auditarNutricaoLLM({ nome, familia, nutricao, motivo }, { model } = {}) {
  const n = nutricao || {};
  const linha = ['energia_kcal', 'gordura', 'gordura_saturada', 'acucares', 'hidratos', 'proteina', 'sal', 'fibra']
    .map((k) => `${k}=${n[k] ?? '—'}`).join(' ');
  const user = `NOME: ${nome || '?'}\nFAMÍLIA: ${familia || '?'}\nSINALIZADO POR: ${motivo || '?'}\nNUTRIÇÃO/100g: ${linha}`;
  for (let tent = 0; tent < 2; tent++) {
    try {
      const txt = await chatCompletion({
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: user }],
        model: model || config.openrouter.modelExtracao,
        responseFormat: { type: 'json_object' },
        timeoutMs: 20000,
        contexto: 'auditar-nutricao',
      });
      const v = JSON.parse(txt);
      if (v && ['ok', 'erro', 'incerto'].includes(v.veredicto)) {
        return {
          veredicto: v.veredicto,
          campos: Array.isArray(v.campos_suspeitos) ? v.campos_suspeitos.slice(0, 6) : [],
          confianca: Number.isFinite(Number(v.confianca)) ? Number(v.confianca) : null,
          resumo: String(v.resumo || '').slice(0, 480),
        };
      }
    } catch { /* retry — o LLM às vezes devolve JSON malformado */ }
  }
  return null;
}

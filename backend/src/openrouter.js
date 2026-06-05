// Cliente OpenRouter (API compatível OpenAI). Uma só chave cobre texto/imagem/
// áudio. Imagem vai como data URL base64 no content (image_url). Áudio (futuro)
// vai como input_audio base64 — URLs não são suportados para áudio.
import { config } from './config.js';

const BASE = 'https://openrouter.ai/api/v1';

export async function chatCompletion({ messages, model, responseFormat, timeoutMs } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || config.openrouter.timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${config.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://bigbag.hal9klabs.com',
        'X-Title': 'Bigbag',
      },
      body: JSON.stringify({
        model: model || config.openrouter.model,
        messages,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 500)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(t);
  }
}

// Conveniência: pergunta multimodal (texto + 1 imagem base64) → texto.
export async function visionPrompt({ prompt, imageBase64, mime = 'image/jpeg', model, responseFormat, timeoutMs }) {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
      ],
    },
  ];
  return chatCompletion({ messages, model, responseFormat, timeoutMs });
}

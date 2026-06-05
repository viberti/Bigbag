// Camada de voz — transcrição (áudio → texto). DECISÃO EM ABERTO no conceito
// (STT-separado vs. áudio-direto); implementada de forma TROCÁVEL.
// v1: STT-via-chat (input_audio em base64; URLs não são suportados para áudio).
// Devolve a transcrição VISÍVEL (bom para depurar PT europeu) e depois a
// interpretação corre no fluxo de texto já existente (responderPergunta).
import { chatCompletion } from './openrouter.js';
import { config } from './config.js';

// Mapeia o mime do gravador do browser para o `format` esperado pelo modelo.
export function formatoDeMime(mime = '') {
  const m = mime.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  return 'webm';
}

export async function transcrever(audioBase64, { mime, format, model, timeoutMs } = {}) {
  const fmt = format || formatoDeMime(mime);
  const texto = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcreve este áudio em português europeu. Devolve SÓ a transcrição exata, sem comentários nem pontuação inventada.',
          },
          { type: 'input_audio', input_audio: { data: audioBase64, format: fmt } },
        ],
      },
    ],
    model: model || config.openrouter.sttModel || config.openrouter.model,
    timeoutMs,
  });
  return String(texto || '').trim();
}

// Rota de consulta por VOZ. PROTEGIDA (gasta a chave OpenRouter).
// POST /api/voz  (multipart, campo "audio") →
//   transcreve → responderPergunta (mesma cadeia de tool use) → resposta.
// Guarda o áudio em /var/lib/bigbag/notas_voz.
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { transcrever, formatoDeMime } from '../transcricao.js';
import { responderPergunta } from '../consulta.js';
import { carregarHistorico, guardarMensagem } from '../historico.js';
import { carregarPerfil } from '../perfil.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

export const vozRouter = Router();

vozRouter.post('/', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta o arquivo "audio"' });
    const mime = req.file.mimetype || 'audio/webm';

    // 1) transcrição (áudio → texto)
    const transcricao = await transcrever(req.file.buffer.toString('base64'), { mime });
    if (!transcricao) return res.status(422).json({ erro: 'Não entendi o áudio.', transcricao: '' });

    // 2) guardar a nota de voz
    await mkdir(config.uploads.voz, { recursive: true });
    const ext = formatoDeMime(mime);
    await writeFile(path.join(config.uploads.voz, `${randomUUID()}.${ext}`), req.file.buffer, { mode: 0o600 });

    // 3) interpretar pela MESMA cadeia de texto (tool use), com memória
    const utilizador = req.user.id;
    const [historico, perfil] = await Promise.all([carregarHistorico(utilizador), carregarPerfil(utilizador)]);
    const out = await responderPergunta(transcricao, { historico, utilizador, perfil });
    await guardarMensagem(utilizador, 'user', transcricao);
    await guardarMensagem(utilizador, 'assistant', out.resposta);
    res.json({ transcricao, ...out });
  } catch (e) {
    console.error('[voz] erro:', e.message);
    res.status(502).json({ erro: 'Falha na consulta por voz', detalhe: e.message });
  }
});

// Rota de consulta por texto. PROTEGIDA (gasta a chave OpenRouter).
// POST /api/consulta { "pergunta": "quanto gastei em queijo este mês?" }
//   → { resposta, chamadas: [{nome, args, resultado}] }
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { responderPergunta } from '../consulta.js';

export const consultaRouter = Router();

consultaRouter.post('/', requireAuth, async (req, res) => {
  const pergunta = req.body?.pergunta;
  if (!pergunta || typeof pergunta !== 'string') {
    return res.status(400).json({ erro: 'Falta "pergunta" (texto)' });
  }
  try {
    const out = await responderPergunta(pergunta);
    res.json(out);
  } catch (e) {
    console.error('[consulta] erro:', e.message);
    res.status(502).json({ erro: 'Falha na consulta', detalhe: e.message });
  }
});

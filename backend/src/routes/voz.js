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
import { chatCompletion } from '../openrouter.js';
import { responderPergunta } from '../consulta.js';
import { carregarHistorico, guardarMensagem } from '../historico.js';
import { carregarPerfil } from '../perfil.js';
// (REMOVIDO 2026-06-13, decisão do dono: o "vocabulário dos habituais" no prompt
// da voz forçava o LLM a ENCAIXAR o que ouvia nos produtos conhecidos — "usa
// EXATAMENTE este nome" distorcia itens novos. O entendimento livre era ótimo;
// a consolidação por chaveItemLista já junta "ovo"="ovos" depois, sem viés.)

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

// Ditado da LISTA DE COMPRAS: áudio → nomes de produtos, direto (sem passar pela
// cadeia de consulta). "bananas, leite e papel higiénico" → ["Bananas","Leite",
// "Papel higiênico"]. O frontend adiciona cada um ao carrinho.
vozRouter.post('/lista', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta o arquivo "audio"' });
    const mime = req.file.mimetype || 'audio/webm';
    const conteudo = await chatCompletion({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'O áudio dita itens para uma lista de compras de supermercado (português). Extrai os PRODUTOS e as QUANTIDADES ditadas e devolve SÓ JSON: {"produtos": [{"nome": "...", "quantidade": N}]}. Regras: nome curto com a 1.ª letra maiúscula, SEM a embalagem nem a quantidade no nome ("2 latas de coca-cola" → nome "Coca-Cola", quantidade 2; "3 dúzias de ovos" → nome "Ovos", quantidade 3; "3 cervejas" → nome "Cerveja", quantidade 3). Sem quantidade dita → 1. Se não houver produtos no áudio, {"produtos": []}.',
            },
            { type: 'input_audio', input_audio: { data: req.file.buffer.toString('base64'), format: formatoDeMime(mime) } },
          ],
        },
      ],
      model: config.openrouter.sttModel || config.openrouter.model,
      responseFormat: { type: 'json_object' },
      timeoutMs: 25000,
      contexto: 'voz-lista',
    });
    let produtos = [];
    try { produtos = JSON.parse(conteudo)?.produtos || []; } catch { produtos = []; }
    // normaliza: aceita objetos {nome, quantidade} (atual) e strings (retrocompat)
    produtos = produtos
      .map((p) => (typeof p === 'string'
        ? { nome: p.trim(), quantidade: 1 }
        : { nome: String(p?.nome || '').trim(), quantidade: Math.max(1, Math.min(99, Number(p?.quantidade) || 1)) }))
      .filter((p) => p.nome)
      .slice(0, 20);
    res.json({ produtos });
  } catch (e) {
    console.error('[voz/lista] erro:', e.message);
    res.status(502).json({ erro: 'Falha a entender a lista', detalhe: e.message });
  }
});

// Consulta de PRODUTO por voz: áudio → o NOME do produto a consultar (curto), p/
// abrir a ficha sem scan ("informação sobre carne de porco" → "carne de porco").
vozRouter.post('/produto', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta o arquivo "audio"' });
    const mime = req.file.mimetype || 'audio/webm';
    const conteudo = await chatCompletion({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'O áudio é um pedido para consultar UM produto de supermercado (português). Devolve SÓ o NOME do produto, curto e em minúsculas (ex.: "carne de porco", "queijo gouda", "iogurte grego"), sem verbos nem comentários ("quero ver", "informação sobre"). JSON: {"produto": "..."} — "" se não houver produto.' },
          { type: 'input_audio', input_audio: { data: req.file.buffer.toString('base64'), format: formatoDeMime(mime) } },
        ],
      }],
      model: config.openrouter.sttModel || config.openrouter.model,
      responseFormat: { type: 'json_object' },
      timeoutMs: 25000,
      contexto: 'voz-produto',
    });
    let produto = '';
    try { produto = String(JSON.parse(conteudo)?.produto || '').trim().slice(0, 120); } catch { produto = ''; }
    res.json({ produto });
  } catch (e) {
    console.error('[voz/produto] erro:', e.message);
    res.status(502).json({ erro: 'Falha a entender o produto', detalhe: e.message });
  }
});

// Rota de ingestão de faturas. PROTEGIDA por requireAuth (a app está exposta).
// POST /api/faturas  (multipart, campo "fatura" = imagem) →
//   extrai (VLM) → reconcilia → grava imagem + BD → devolve resumo.
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { extrairFatura, extrairFaturaDeTexto } from '../ingest/extract.js';
import { extrairTextoPdf } from '../ingest/pdf.js';
import { distribuirDesconto } from '../ingest/reconcile.js';
import { persistirFatura } from '../ingest/persist.js';
import { extrairFormato, precoPorBase } from '../normaliza/formato.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

export const faturasRouter = Router();

faturasRouter.post('/', requireAuth, upload.single('fatura'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta o ficheiro "fatura" (imagem ou PDF)' });
    const mime = req.file.mimetype || 'application/octet-stream';
    const ehPdf = mime === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');

    // 1) extração — PDF (texto+LLM, Abordagem B) OU imagem (VLM, Abordagem A)
    let dados;
    let metodo;
    if (ehPdf) {
      const texto = await extrairTextoPdf(req.file.buffer);
      dados = await extrairFaturaDeTexto(texto);
      metodo = 'ocr_llm';
    } else {
      dados = await extrairFatura({ imageBase64: req.file.buffer.toString('base64'), mime });
      metodo = 'vlm';
    }

    // snapshot do que o VLM extraiu (antes da reconciliação), para debug
    const extracaoJson = {
      loja: dados.loja,
      data_compra: dados.data_compra,
      subtotal: dados.subtotal,
      desconto_global: dados.desconto_global,
      total_impresso: dados.total_impresso,
      itens: dados.itens,
    };

    // 2) reconciliação determinística (distribui desconto global)
    const rec = distribuirDesconto(dados.itens, {
      descontoGlobal: Number(dados.desconto_global) || 0,
      totalImpresso: dados.total_impresso,
    });
    dados.itens = rec.itens;

    // 2b) Camada 1 da normalização: formato → preco_por_base (€/kg, €/L, €/un)
    for (const it of dados.itens) {
      if (it.is_non_product) {
        it.preco_por_base = null;
        continue;
      }
      const f = extrairFormato(it.descricao_original);
      it.preco_por_base = precoPorBase({ preco_liquido: it.preco_liquido, quantidade: it.quantidade }, f);
    }

    // 3) gravar a imagem original
    await mkdir(config.uploads.faturas, { recursive: true });
    const ext = ehPdf ? 'pdf' : (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const ficheiro = path.join(config.uploads.faturas, `${randomUUID()}.${ext}`);
    await writeFile(ficheiro, req.file.buffer, { mode: 0o600 });

    // 4) persistir (com deduplicação)
    const resultado = await persistirFatura(getPool(), dados, {
      ficheiroOriginal: ficheiro,
      metodo,
      totalReconciliado: rec.totalReconciliado,
      discrepancia: rec.discrepancia,
      needsReview: !rec.extracaoBate,
      extracaoJson,
    });
    if (resultado.duplicada) {
      await unlink(ficheiro).catch(() => {}); // imagem órfã: a fatura já existia
      return res.json({
        duplicada: true,
        fatura_id: resultado.fatura_id,
        loja: dados.loja,
        data_compra: dados.data_compra,
        total_impresso: dados.total_impresso,
      });
    }
    const { fatura_id, loja_id, n_itens } = resultado;

    // 5) resumo para o utilizador (inclui sinal de qualidade da extração)
    res.json({
      fatura_id,
      loja_id,
      metodo_extracao: metodo,
      loja: dados.loja,
      data_compra: dados.data_compra,
      total_impresso: dados.total_impresso,
      subtotal_extraido: Math.round(rec.subtotal * 100) / 100,
      total_reconciliado: Math.round(rec.totalReconciliado * 100) / 100,
      desconto_global: Number(dados.desconto_global) || 0,
      extracao_bate: rec.extracaoBate,
      needs_review: !rec.extracaoBate,
      discrepancia: rec.discrepancia,
      convencao: rec.convencao,
      n_itens,
      itens: dados.itens.map((it) => ({
        descricao_original: it.descricao_original,
        preco_unitario: it.preco_unitario,
        preco_liquido: it.preco_liquido,
        preco_por_base: it.preco_por_base ?? null,
        desconto_direto: Number(it.desconto_direto) || 0,
        is_clearance: !!it.is_clearance,
        is_non_product: !!it.is_non_product,
      })),
    });
  } catch (e) {
    console.error('[faturas] erro:', e.message);
    res.status(502).json({ erro: 'Falha na ingestão', detalhe: e.message });
  }
});

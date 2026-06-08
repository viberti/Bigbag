// Identificar/enriquecer um produto: o utilizador envia FOTOS dos rótulos + (op.)
// o EAN. Corre o VLM sobre as fotos E consulta o OFF pelo EAN, guarda e devolve
// AMBOS — em ambiente de teste, para ver o que se obtém de cada fonte.
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';
import { extrairProdutoFotos, consultarOFF } from '../ingest/produto.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 6 } });
export const produtoRouter = Router();

produtoRouter.post('/identificar', requireAuth, upload.array('fotos', 6), async (req, res) => {
  try {
    const eanManual = String(req.body?.ean || '').replace(/\D/g, '') || null;
    const skuId = Number(req.body?.sku_id) || null;
    const fotos = (req.files || []).map((f) => ({ base64: f.buffer.toString('base64'), mime: f.mimetype || 'image/jpeg' }));
    if (!fotos.length && !eanManual) return res.status(400).json({ erro: 'Envia pelo menos uma foto ou um EAN.' });

    // VLM sobre as fotos
    let vlm = null, custo = 0;
    if (fotos.length) {
      try { const r = await extrairProdutoFotos(fotos); vlm = r.dados; custo = r.custo; }
      catch (e) { vlm = { erro: e.message }; }
    }
    // EAN para o OFF: o manual, senão o que o VLM leu na foto
    const ean = eanManual || (vlm?.ean ? String(vlm.ean).replace(/\D/g, '') : null);
    const off = await consultarOFF(ean);

    const nutricao = off?.nutricao_100g || vlm?.nutricao_100g || null;
    const fonte = off && vlm ? 'ambos' : off ? 'off' : 'vlm';
    const nome = off?.nome || vlm?.nome || null;

    try {
      await getPool().query(
        `INSERT INTO produto_ean (ean, sku_id, nome, marca, quantidade, categoria, ingredientes, alergenios, validade, nutricao, fonte, vlm_json, off_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE sku_id=COALESCE(VALUES(sku_id),sku_id), nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade),
           categoria=VALUES(categoria), ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), validade=VALUES(validade),
           nutricao=VALUES(nutricao), fonte=VALUES(fonte), vlm_json=VALUES(vlm_json), off_json=VALUES(off_json)`,
        [ean, skuId, nome, off?.marca || vlm?.marca || null, off?.quantidade || vlm?.quantidade || null, off?.categoria || vlm?.categoria || null,
          off?.ingredientes || vlm?.ingredientes || null, off?.alergenios || vlm?.alergenios || null, vlm?.validade || null,
          nutricao ? JSON.stringify(nutricao) : null, fonte, vlm ? JSON.stringify(vlm) : null, off ? JSON.stringify(off) : null],
      );
    } catch (e) { console.error('[produto/identificar] guardar:', e.message); }

    res.json({ ean, vlm, off, fonte, custo, n_fotos: fotos.length });
  } catch (e) {
    console.error('[produto/identificar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a identificar o produto' });
  }
});

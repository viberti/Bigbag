// Identificar/enriquecer um produto: o utilizador envia FOTOS dos rótulos + (op.)
// o EAN. Corre o VLM sobre as fotos E consulta o OFF pelo EAN, guarda e devolve
// AMBOS — em ambiente de teste, para ver o que se obtém de cada fonte.
import { Router } from 'express';
import multer from 'multer';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';
import { config } from '../config.js';
import { extrairProdutoFotos, consultarOFF } from '../ingest/produto.js';

// Fotos dos produtos vivem ao lado das das notas, num subdiretório 'produtos'.
const DIR_FOTOS = path.join(path.dirname(config.uploads.faturas), 'produtos');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 6 } });
export const produtoRouter = Router();

produtoRouter.post('/identificar', requireAuth, upload.array('fotos', 6), async (req, res) => {
  try {
    const eanManual = String(req.body?.ean || '').replace(/\D/g, '') || null;
    const skuId = Number(req.body?.sku_id) || null;
    const itemId = Number(req.body?.item_id) || null;
    const ficheiros = req.files || [];
    const fotos = ficheiros.map((f) => ({ base64: f.buffer.toString('base64'), mime: f.mimetype || 'image/jpeg' }));
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

    // guarda as FOTOS em disco, ligadas ao item (foco: conhecer bem o item comprado)
    let nGuardadas = 0;
    if (ficheiros.length) {
      try {
        await mkdir(DIR_FOTOS, { recursive: true });
        for (let i = 0; i < ficheiros.length; i++) {
          const f = ficheiros[i];
          const ext = (f.mimetype?.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          const fich = path.join(DIR_FOTOS, `${randomUUID()}.${ext}`);
          await writeFile(fich, f.buffer, { mode: 0o600 });
          await getPool().query('INSERT INTO produto_foto (item_id, ean, ficheiro, mime, ordem) VALUES (?,?,?,?,?)', [itemId, ean, fich, f.mimetype || null, i]);
          nGuardadas++;
        }
      } catch (e) { console.error('[produto/identificar] guardar fotos:', e.message); }
    }

    try {
      await getPool().query(
        `INSERT INTO produto_ean (ean, sku_id, item_id, nome, marca, quantidade, categoria, ingredientes, alergenios, validade, nutricao, fonte, vlm_json, off_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE sku_id=COALESCE(VALUES(sku_id),sku_id), item_id=COALESCE(VALUES(item_id),item_id), nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade),
           categoria=VALUES(categoria), ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), validade=VALUES(validade),
           nutricao=VALUES(nutricao), fonte=VALUES(fonte), vlm_json=VALUES(vlm_json), off_json=VALUES(off_json)`,
        [ean, skuId, itemId, nome, off?.marca || vlm?.marca || null, off?.quantidade || vlm?.quantidade || null, off?.categoria || vlm?.categoria || null,
          off?.ingredientes || vlm?.ingredientes || null, off?.alergenios || vlm?.alergenios || null, vlm?.validade || null,
          nutricao ? JSON.stringify(nutricao) : null, fonte, vlm ? JSON.stringify(vlm) : null, off ? JSON.stringify(off) : null],
      );
    } catch (e) { console.error('[produto/identificar] guardar:', e.message); }

    res.json({ ean, vlm, off, fonte, custo, n_fotos: fotos.length, fotos_guardadas: nGuardadas });
  } catch (e) {
    console.error('[produto/identificar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a identificar o produto' });
  }
});

// Toda a info que TEMOS de um produto, consolidada (por item da nota OU por EAN).
// Junta as várias linhas de produto_ean do item (ex.: uma com EAN+nutrição, outra
// só com ingredientes) num único vlm/off, e lista as fotos guardadas.
produtoRouter.get('/info', requireAuth, async (req, res) => {
  try {
    const itemId = Number(req.query.item_id) || null;
    const eanQ = String(req.query.ean || '').replace(/\D/g, '') || null;
    if (!itemId && !eanQ) return res.status(400).json({ erro: 'item_id ou ean em falta' });

    const [rows] = itemId
      ? await getPool().query('SELECT * FROM produto_ean WHERE item_id = ? ORDER BY id', [itemId])
      : await getPool().query('SELECT * FROM produto_ean WHERE ean = ? ORDER BY id', [eanQ]);

    const parse = (j) => { try { return j ? (typeof j === 'string' ? JSON.parse(j) : j) : null; } catch { return null; } };
    // Preenche lacunas: o 1.º valor não-nulo ganha; objetos fundem-se recursivamente.
    const fill = (acc, src) => {
      if (!src) return acc;
      acc = acc || {};
      for (const [k, v] of Object.entries(src)) {
        if (v == null) continue;
        if (acc[k] == null) acc[k] = v;
        else if (typeof v === 'object' && typeof acc[k] === 'object' && !Array.isArray(v)) acc[k] = fill(acc[k], v);
      }
      return acc;
    };
    let vlm = null, off = null, ean = eanQ;
    for (const r of rows) {
      if (r.ean) ean = r.ean;
      vlm = fill(vlm, parse(r.vlm_json));
      off = fill(off, parse(r.off_json));
    }

    const [fotos] = itemId
      ? await getPool().query('SELECT id, ordem FROM produto_foto WHERE item_id = ? ORDER BY ordem, id', [itemId])
      : await getPool().query('SELECT id, ordem FROM produto_foto WHERE ean = ? ORDER BY ordem, id', [ean]);

    const fonte = vlm && off ? 'ambos' : off ? 'off' : vlm ? 'vlm' : null;
    res.json({ ean, vlm, off, fonte, fotos, existe: rows.length > 0 });
  } catch (e) {
    console.error('[produto/info] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar info do produto' });
  }
});

// Serve uma foto de produto (com auth). O caminho vem da BD (fora do static root).
produtoRouter.get('/foto/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[f]] = await getPool().query('SELECT ficheiro, mime FROM produto_foto WHERE id = ?', [id]);
    if (!f?.ficheiro) return res.status(404).json({ erro: 'Sem foto' });
    if (f.mime) res.type(f.mime);
    res.sendFile(f.ficheiro, (err) => { if (err && !res.headersSent) res.status(404).json({ erro: 'Foto não encontrada' }); });
  } catch (e) {
    console.error('[produto/foto] erro:', e.message);
    if (!res.headersSent) res.status(500).json({ erro: 'Falha a servir foto' });
  }
});

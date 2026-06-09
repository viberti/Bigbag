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
import { extrairProdutoFotos, consultarOFF, analisarProduto, caracterizarProdutoNome, eanValido, lerEanDeFoto, analisarFotoProduto, buscarOffPorNome, garantirGenericoSku } from '../ingest/produto.js';
import { alertasDoPerfil, avaliarParaPerfil } from '../ingest/perfil.js';

// Fotos dos produtos vivem ao lado das das notas, num subdiretório 'produtos'.
const DIR_FOTOS = path.join(path.dirname(config.uploads.faturas), 'produtos');

const parseJson = (j) => { try { return j ? (typeof j === 'string' ? JSON.parse(j) : j) : null; } catch { return null; } };

// Consulta um produto pelo EAN: nossa base → Open Food Facts (e GUARDA, item_id
// NULL). Devolve { encontrado, fonte, nome }. Partilhado por /consultar e /foto.
async function consultarOuGuardar(ean) {
  const [[ja]] = await getPool().query(
    `SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(off_json,'$.nome')), nome) AS nome
       FROM produto_ean WHERE ean = ? AND (off_json IS NOT NULL OR vlm_json IS NOT NULL) ORDER BY id LIMIT 1`,
    [ean],
  );
  if (ja) return { encontrado: true, fonte: 'base', nome: ja.nome || null };
  const off = await consultarOFF(ean);
  if (!off) return { encontrado: false };
  try {
    await getPool().query(
      `INSERT INTO produto_ean (ean, item_id, sku_id, nome, marca, quantidade, categoria, ingredientes, alergenios, nutricao, fonte, off_json)
         VALUES (?,NULL,NULL,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
         ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), nutricao=VALUES(nutricao), fonte=VALUES(fonte), off_json=VALUES(off_json)`,
      [ean, off.nome, off.marca, off.quantidade, off.categoria, off.ingredientes, off.alergenios,
        off.nutricao_100g ? JSON.stringify(off.nutricao_100g) : null, 'off', JSON.stringify(off)],
    );
    await guardarNomes(ean, null, [{ nome: off.nome, origem: 'off' }]);
  } catch (e) {
    console.error('[consultarOuGuardar] guardar:', e.message);
  }
  return { encontrado: true, fonte: 'off', nome: off.nome || null };
}

// Guarda todos os nomes vistos para um produto (por EAN), para matching/canónico.
async function guardarNomes(ean, skuId, nomes) {
  if (!ean) return; // só com EAN válido (identidade forte do produto)
  const vistos = new Set();
  for (const { nome, origem } of nomes) {
    const n = String(nome || '').trim();
    if (!n || /^null$/i.test(n) || vistos.has(n.toLowerCase())) continue;
    vistos.add(n.toLowerCase());
    await getPool()
      .query('INSERT IGNORE INTO produto_nome (ean, sku_id, nome, origem) VALUES (?,?,?,?)', [ean, skuId || null, n, origem])
      .catch((e) => console.error('[produto_nome]', e.message));
  }
}
// Preenche lacunas: o 1.º valor não-nulo ganha; objetos fundem-se recursivamente.
const fillGaps = (acc, src) => {
  if (!src) return acc;
  acc = acc || {};
  for (const [k, v] of Object.entries(src)) {
    if (v == null) continue;
    if (acc[k] == null) acc[k] = v;
    else if (typeof v === 'object' && typeof acc[k] === 'object' && !Array.isArray(v)) acc[k] = fillGaps(acc[k], v);
  }
  return acc;
};

// Consolida TUDO o que sabemos de um produto (por item da nota OU por EAN):
// funde as várias linhas de produto_ean (vlm/off) e lista as fotos guardadas.
async function consolidarProduto({ itemId, eanQ, skuId: skuParam }) {
  // dados do item: SKU (fallback genérico) + EAN do TALÃO (autoritativo).
  let skuId = skuParam || null, nome = null, itemEan = null;
  if (itemId) {
    const [[it]] = await getPool().query(
      `SELECT i.sku_id, i.ean, COALESCE(s.nome_canonico, i.descricao_original) AS nome FROM item i
         LEFT JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.id = ?`,
      [itemId],
    );
    skuId = it?.sku_id || null;
    nome = it?.nome || null;
    itemEan = it?.ean || null;
  }
  // EAN autoritativo: o do TALÃO sobrepõe-se ao lido à mão; senão o eanQ pedido.
  const ean = itemEan || eanQ || null;

  // produto_ean: pelo EAN autoritativo (ignora identificações manuais com OUTRO
  // EAN); se o item não tem EAN, pela identificação manual (item_id).
  const [rows] = ean
    ? await getPool().query('SELECT * FROM produto_ean WHERE ean = ? ORDER BY id', [ean])
    : itemId
      ? await getPool().query('SELECT * FROM produto_ean WHERE item_id = ? ORDER BY id', [itemId])
      : [[]];
  let vlm = null, off = null;
  for (const r of rows) {
    vlm = fillGaps(vlm, parseJson(r.vlm_json));
    off = fillGaps(off, parseJson(r.off_json));
  }
  const [fotos] = ean
    ? await getPool().query('SELECT id, ordem FROM produto_foto WHERE ean = ? OR item_id = ? ORDER BY ordem, id', [ean, itemId])
    : itemId
      ? await getPool().query('SELECT id, ordem FROM produto_foto WHERE item_id = ? ORDER BY ordem, id', [itemId])
      : [[]];

  let generico = null;
  if (skuId) {
    const [[g]] = await getPool().query('SELECT tipo, alimento, categoria, nutricao FROM produto_generico WHERE sku_id = ?', [skuId]);
    if (g) generico = { tipo: g.tipo, alimento: g.alimento, categoria: g.categoria, nutricao_100g: parseJson(g.nutricao) };
  }

  const temGenericoNut = !!generico?.nutricao_100g;
  const fonte = vlm && off ? 'ambos' : off ? 'off' : vlm ? 'vlm' : temGenericoNut ? 'generico' : null;
  return { ean, vlm, off, generico, skuId, nome, fonte, fotos, existe: rows.length > 0 || temGenericoNut };
}

const MAX_FOTOS = 10;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: MAX_FOTOS } });
export const produtoRouter = Router();

// Recebe as fotos tratando os erros do multer (ex.: demasiados ficheiros) com uma
// mensagem clara em JSON — senão o erro vira 500 e a app só mostra "Falha".
const receberFotos = (req, res, next) =>
  upload.array('fotos', MAX_FOTOS)(req, res, (err) => {
    if (!err) return next();
    const msg =
      err.code === 'LIMIT_FILE_COUNT' ? `Demasiadas fotos (máximo ${MAX_FOTOS} por produto).`
      : err.code === 'LIMIT_FILE_SIZE' ? 'Há uma foto demasiado grande (máx. 12 MB).'
      : 'Falha ao receber as fotos.';
    return res.status(400).json({ erro: msg });
  });

const tokensNome = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3);

// Resolve a nutrição GENÉRICA (por nome) para um produto SEM EAN lido numa foto
// solta (câmara inteligente, sem compra). Camada PARTILHADA: 1) reusa um SKU já
// conhecido que combine → cache (zero LLM); 2) senão caracteriza e, se for FRESCO,
// cria uma entrada de catálogo (SKU canónico) para o conhecimento não se perder —
// mesmo que ninguém o tenha comprado. Devolve o genérico + sku_id.
async function resolverGenericoPorNome(pool, nome) {
  const limpo = String(nome || '').trim();
  const toks = tokensNome(limpo).filter((t) => t.length >= 4);
  if (!toks.length) return null;
  // 1) casar com SKU existente pelo token mais distintivo (reusa a cache)
  const tok = toks.sort((a, b) => b.length - a.length)[0];
  const [rows] = await pool.query('SELECT id, nome_canonico FROM sku_normalizado WHERE LOWER(nome_canonico) LIKE ? LIMIT 12', [`%${tok}%`]);
  const alvo = new Set(toks);
  let skuId = null, best = 0;
  for (const r of rows) {
    const ct = new Set(tokensNome(r.nome_canonico));
    let hit = 0; for (const t of alvo) if (ct.has(t)) hit++;
    const score = hit / alvo.size;
    if (score > best && score >= 0.5) { best = score; skuId = r.id; }
  }
  if (skuId) {
    const g = await garantirGenericoSku(pool, skuId, limpo);
    return g ? { ...g, sku_id: skuId } : null;
  }
  // 2) sem SKU: caracteriza; se FRESCO, cria entrada de catálogo (não se perde)
  const { dados, custo } = await caracterizarProdutoNome(limpo);
  if (dados.tipo !== 'fresco') return { tipo: 'processado', alimento: dados.alimento || null, nutricao_100g: null, custo, sku_id: null };
  const nomeCanon = (dados.alimento || limpo).replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 160);
  const [ins] = await pool.query('INSERT INTO sku_normalizado (nome_canonico) VALUES (?)', [nomeCanon]);
  await pool.query(
    `INSERT INTO produto_generico (sku_id, tipo, alimento, categoria, nutricao, modelo) VALUES (?,?,?,?,?,?)`,
    [ins.insertId, 'fresco', dados.alimento || null, dados.categoria || null,
      dados.nutricao_100g ? JSON.stringify(dados.nutricao_100g) : null, config.openrouter.modelConsulta],
  );
  return { tipo: 'fresco', alimento: dados.alimento || null, categoria: dados.categoria || null, nutricao_100g: dados.nutricao_100g || null, custo, sku_id: ins.insertId, criado: true };
}

produtoRouter.post('/identificar', requireAuth, receberFotos, async (req, res) => {
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
    // EAN para o OFF: o manual, senão o que o VLM leu na foto. SÓ se passar o
    // dígito verificador (apanha leituras erradas → evita produtos-fantasma).
    const eanCandidato = eanManual || (vlm?.ean ? String(vlm.ean).replace(/\D/g, '') : null);
    const ean = eanCandidato && eanValido(eanCandidato) ? eanCandidato : null;
    const eanRejeitado = !!(eanCandidato && !ean); // leu um código mas o dígito verificador falhou
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
      // Guarda anti-acumulação: a re-identificação do MESMO item substitui as
      // fichas anteriores SEM EAN (o upsert só dedupe por EAN; com ean=NULL,
      // cada foto criava uma linha nova → duplicados na despensa). As fichas COM
      // EAN ficam (catálogo por EAN; o ON DUPLICATE KEY UPDATE trata-as).
      if (itemId) {
        await getPool().query('DELETE FROM produto_ean WHERE item_id = ? AND ean IS NULL', [itemId]);
      }
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

    // guarda todos os nomes vistos para este produto (matching / nome canónico)
    try {
      let descNota = null, nomeCanon = null, skuItem = skuId;
      if (itemId) {
        const [[it]] = await getPool().query(
          'SELECT i.sku_id, i.descricao_original AS d, s.nome_canonico AS c FROM item i LEFT JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.id = ?',
          [itemId],
        );
        descNota = it?.d || null;
        nomeCanon = it?.c || null;
        skuItem = it?.sku_id || skuId;
      }
      await guardarNomes(ean, skuItem, [
        { nome: nomeCanon, origem: 'canonico' },
        { nome: descNota, origem: 'talao' },
        { nome: vlm?.nome, origem: 'vlm' },
        { nome: off?.nome, origem: 'off' },
      ]);
    } catch (e) { console.error('[produto/identificar] nomes:', e.message); }

    // Sem EAN nem nutrição do rótulo → cai para a NUTRIÇÃO-POR-NOME (frescos),
    // com cache por SKU (chama o LLM só na 1.ª vez). Ex.: fotografar uma fraldinha.
    let generico = null;
    try {
      if (!nutricao) {
        let skuAlvo = skuId;
        let nomeAlvo = vlm?.nome || nome || null;
        if (itemId) {
          const [[it]] = await getPool().query('SELECT i.sku_id, COALESCE(s.nome_canonico, i.descricao_original) AS n FROM item i LEFT JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.id = ?', [itemId]);
          skuAlvo = it?.sku_id || skuAlvo;
          nomeAlvo = nomeAlvo || it?.n || null;
        }
        if (skuAlvo) generico = await garantirGenericoSku(getPool(), skuAlvo, nomeAlvo);
      }
    } catch (e) { console.error('[produto/identificar] generico:', e.message); }

    res.json({ ean, vlm, off, generico, fonte: fonte || (generico?.nutricao_100g ? 'generico' : null), custo, n_fotos: fotos.length, fotos_guardadas: nGuardadas, ean_rejeitado: eanRejeitado });
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
    const skuId = Number(req.query.sku_id) || null;
    if (!itemId && !eanQ && !skuId) return res.status(400).json({ erro: 'item_id, sku_id ou ean em falta' });
    res.json(await consolidarProduto({ itemId, eanQ, skuId }));
  } catch (e) {
    console.error('[produto/info] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar info do produto' });
  }
});

// Lê o EAN de uma FOTO do código de barras (fallback do scanner ao vivo). Valida
// o dígito verificador antes de devolver.
produtoRouter.post('/ler-ean', requireAuth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta a foto' });
    const { ean } = await lerEanDeFoto({ base64: req.file.buffer.toString('base64'), mime: req.file.mimetype || 'image/jpeg' });
    if (ean && eanValido(ean)) return res.json({ ean });
    res.json({ ean: null });
  } catch (e) {
    console.error('[produto/ler-ean] erro:', e.message);
    res.status(500).json({ erro: 'Falha a ler o código' });
  }
});

// Consultar um produto pelo EAN (scan no mercado), SEM ligação a nota. Se já o
// conhecemos, devolve da nossa base; senão busca no Open Food Facts, GUARDA
// (item_id NULL) para uso futuro, e devolve.
produtoRouter.get('/consultar', requireAuth, async (req, res) => {
  try {
    const ean = String(req.query.ean || '').replace(/\D/g, '');
    if (!eanValido(ean)) return res.status(400).json({ erro: 'Código de barras inválido', ean });
    res.json({ ean, ...(await consultarOuGuardar(ean)) });
  } catch (e) {
    console.error('[produto/consultar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a consultar o produto' });
  }
});

// Câmara "inteligente": classifica a foto (talão/produto/outro). Se produto,
// tenta o EAN (do rótulo ou via OFF por nome) e devolve o resultado da consulta.
produtoRouter.post('/foto', requireAuth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta a foto' });
    const foto = { base64: req.file.buffer.toString('base64'), mime: req.file.mimetype || 'image/jpeg' };
    const { dados } = await analisarFotoProduto(foto);
    if (dados.tipo === 'talao') return res.json({ tipo: 'talao' });
    if (dados.tipo !== 'produto') return res.json({ tipo: 'outro' });

    let ean = dados.ean ? String(dados.ean).replace(/\D/g, '') : null;
    if (ean && !eanValido(ean)) ean = null;
    if (!ean && dados.nome) ean = await buscarOffPorNome([dados.nome, dados.marca].filter(Boolean).join(' '));
    if (ean && eanValido(ean)) {
      const r = await consultarOuGuardar(ean);
      return res.json({ tipo: 'produto', ean, ...r, lido: dados.nome || null });
    }
    // Sem EAN: cair para a NUTRIÇÃO-POR-NOME (frescos sem código de barras, ex.:
    // "fraldinha"). Reusa/enriquece o catálogo partilhado e nunca fica mudo.
    const gen = dados.nome ? await resolverGenericoPorNome(getPool(), dados.nome).catch(() => null) : null;
    if (gen?.nutricao_100g) {
      return res.json({ tipo: 'produto', encontrado: true, fonte: 'generico', nome: dados.nome || gen.alimento || null, marca: dados.marca || null, sku_id: gen.sku_id, generico: gen });
    }
    res.json({ tipo: 'produto', encontrado: false, nome: dados.nome || null, marca: dados.marca || null, generico: gen || null });
  } catch (e) {
    console.error('[produto/foto] erro:', e.message);
    res.status(500).json({ erro: 'Falha a analisar a foto' });
  }
});

// "Despensa" da casa: os produtos que conhecemos (com EAN), por ordem de compra
// (data) decrescente. Dedup por EAN, mantendo a compra mais recente.
produtoRouter.get('/despensa', requireAuth, async (req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT pe.ean, pe.item_id, pe.id AS pe_id,
             COALESCE(s.nome_canonico, i.descricao_original, JSON_UNQUOTE(JSON_EXTRACT(pe.off_json,'$.nome')), pe.nome) AS nome,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pe.off_json,'$.marca')), pe.marca) AS marca,
             COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pe.vlm_json,'$.validade_iso')), 'null'), NULLIF(pe.validade, 'null')) AS validade,
             f.data_compra AS data,
             COALESCE(l.cadeia, l.nome) AS loja
        FROM produto_ean pe
        LEFT JOIN item i ON i.id = pe.item_id
        LEFT JOIN sku_normalizado s ON s.id = i.sku_id
        LEFT JOIN fatura f ON f.id = i.fatura_id
        LEFT JOIN loja l ON l.id = f.loja_id
       WHERE pe.ean IS NOT NULL AND pe.item_id IS NOT NULL
       ORDER BY f.data_compra DESC, pe.id DESC`);
    const limparVal = (v) => { const s = String(v ?? '').trim(); return s && !/^null$/i.test(s) ? s : null; };
    const vistos = new Set();
    const produtos = [];
    for (const r of rows) {
      if (vistos.has(r.ean)) continue;
      vistos.add(r.ean);
      produtos.push({ ean: r.ean, item_id: r.item_id, nome: r.nome, marca: r.marca, validade: limparVal(r.validade), data: r.data, loja: r.loja });
    }
    res.json({ produtos });
  } catch (e) {
    console.error('[produto/despensa] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar a despensa' });
  }
});

// Produtos que PRECISAM de fotos (embalados sem EAN, não-frescos), por compra
// (data/loja) decrescente — worklist de identificação.
produtoRouter.get('/por-identificar', requireAuth, async (req, res) => {
  try {
    const [itens] = await getPool().query(`
      SELECT i.id AS item_id, i.sku_id,
             COALESCE(s.nome_canonico, i.descricao_original) AS produto,
             f.id AS fatura_id, f.data_compra AS data, COALESCE(l.cadeia, l.nome) AS loja
        FROM item i
        LEFT JOIN sku_normalizado s ON s.id = i.sku_id
        LEFT JOIN produto_generico pg ON pg.sku_id = i.sku_id
        JOIN fatura f ON f.id = i.fatura_id
        JOIN loja l ON l.id = f.loja_id
       WHERE i.is_non_product = 0
         AND (pg.tipo IS NULL OR pg.tipo <> 'fresco')
         -- identificado se QUALQUER compra com o mesmo nome E na mesma cadeia já tem
         -- EAN (identificar uma "Salada Gourmet" do Continente vale para todas as do
         -- Continente com esse nome; entre cadeias não — pode ser outra marca-própria).
         AND NOT EXISTS (
           SELECT 1 FROM produto_ean pe
             JOIN item i2 ON i2.id = pe.item_id
             JOIN fatura f2 ON f2.id = i2.fatura_id
             JOIN loja l2 ON l2.id = f2.loja_id
            WHERE pe.ean IS NOT NULL
              AND i2.descricao_original = i.descricao_original
              AND COALESCE(l2.cadeia, l2.nome) = COALESCE(l.cadeia, l.nome))
       ORDER BY f.data_compra DESC, f.id DESC, i.id`);
    res.json({ itens });
  } catch (e) {
    console.error('[produto/por-identificar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar produtos por identificar' });
  }
});

// Análise factual (não clínica) do produto: ingredientes explicados, NOVA,
// Nutri-Score com porquê, destaques. Cacheada por EAN (re-gera com ?forcar=1).
produtoRouter.get('/analise', requireAuth, async (req, res) => {
  try {
    const itemId = Number(req.query.item_id) || null;
    const eanQ = String(req.query.ean || '').replace(/\D/g, '') || null;
    const forcar = String(req.query.forcar || '') === '1';
    if (!itemId && !eanQ) return res.status(400).json({ erro: 'item_id ou ean em falta' });

    const info = await consolidarProduto({ itemId, eanQ });
    if (!info.existe) return res.status(404).json({ erro: 'Produto sem dados para analisar' });
    const ean = info.ean || null;
    // chave de cache: EAN (embalados) ou sku:<id> (frescos genéricos)
    const chave = ean || (info.skuId ? `sku:${info.skuId}` : null);

    if (chave && !forcar) {
      const [[c]] = await getPool().query('SELECT analise FROM produto_analise WHERE ean = ?', [chave]);
      if (c?.analise) return res.json({ analise: parseJson(c.analise), cacheada: true });
    }

    // melhor fonte por campo: ingredientes do rótulo (vlm) > off; nutrição: off > vlm > genérico
    const ehFresco = info.generico?.tipo === 'fresco';
    const p = {
      nome: info.off?.nome || info.vlm?.nome || info.generico?.alimento || info.nome || null,
      categoria: info.off?.categoria || info.vlm?.categoria || info.generico?.categoria || null,
      ingredientes: info.vlm?.ingredientes || info.off?.ingredientes || null,
      nutricao_100g: info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null,
      nutriscore: info.off?.nutriscore || null,
      nova: info.off?.nova ?? (ehFresco ? 1 : null), // fresco/inteiro → NOVA 1
    };
    if (!p.ingredientes && !p.nutricao_100g) {
      return res.status(422).json({ erro: 'Sem ingredientes nem nutrição para analisar' });
    }

    const { analise, custo } = await analisarProduto(p);
    if (chave) {
      await getPool()
        .query('INSERT INTO produto_analise (ean, analise, modelo) VALUES (?,?,?) ON DUPLICATE KEY UPDATE analise=VALUES(analise), modelo=VALUES(modelo), criado_em=CURRENT_TIMESTAMP', [
          chave,
          JSON.stringify(analise),
          'modelConsulta',
        ])
        .catch((e) => console.error('[produto/analise] cache:', e.message));
    }
    res.json({ analise, custo, cacheada: false });
  } catch (e) {
    console.error('[produto/analise] erro:', e.message);
    res.status(500).json({ erro: 'Falha a analisar o produto' });
  }
});

// Avaliação PERSONALIZADA do produto à luz do perfil ATIVO (alergias/limiares
// determinísticos + parecer do LLM). Devolve { perfil:null } se não houver perfil.
produtoRouter.get('/personalizado', requireAuth, async (req, res) => {
  try {
    const itemId = Number(req.query.item_id) || null;
    const eanQ = String(req.query.ean || '').replace(/\D/g, '') || null;
    if (!itemId && !eanQ) return res.status(400).json({ erro: 'item_id ou ean em falta' });

    const [[p]] = await getPool().query('SELECT id, nome, resumo FROM perfil_membro WHERE ativo = 1 LIMIT 1');
    if (!p) return res.json({ perfil: null });
    const resumo = typeof p.resumo === 'string' ? JSON.parse(p.resumo) : p.resumo;

    const info = await consolidarProduto({ itemId, eanQ });
    const produto = {
      nome: info.off?.nome || info.vlm?.nome || info.generico?.alimento || info.nome || null,
      categoria: info.off?.categoria || info.vlm?.categoria || info.generico?.categoria || null,
      ingredientes: info.vlm?.ingredientes || info.off?.ingredientes || null,
      alergenios: info.off?.alergenios || info.vlm?.alergenios || null,
      nutricao_100g: info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null,
      nutriscore: info.off?.nutriscore || null,
      nova: info.off?.nova ?? null,
    };

    const alertas = alertasDoPerfil(produto, resumo);
    let avaliacao = null, custo = 0;
    try {
      const r = await avaliarParaPerfil(produto, resumo);
      avaliacao = r.avaliacao;
      custo = r.custo;
    } catch (e) {
      console.error('[produto/personalizado] avaliar:', e.message);
    }
    res.json({ perfil: p.nome, alertas, avaliacao, custo });
  } catch (e) {
    console.error('[produto/personalizado] erro:', e.message);
    res.status(500).json({ erro: 'Falha na avaliação personalizada' });
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

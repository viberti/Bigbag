// Identificar/enriquecer um produto: o utilizador envia FOTOS dos rótulos + (op.)
// o EAN. Corre o VLM sobre as fotos E consulta o OFF pelo EAN, guarda e devolve
// AMBOS — em ambiente de teste, para ver o que se obtém de cada fonte.
import { Router } from 'express';
import multer from 'multer';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';
import { config } from '../config.js';
import { extrairProdutoFotos, consultarOFF, analisarProduto, caracterizarProdutoNome, eanValido, lerEanDeFoto, analisarFotoProduto, buscarOffPorNome, garantirGenericoSku } from '../ingest/produto.js';
import { atualizarConteudoFicha } from '../normaliza/conteudo.js';
import { grupoDe, tokenCasa } from '../normaliza/categoria.js';
import { alertasDoPerfil, avaliarParaPerfil, compararProdutosLLM } from '../ingest/perfil.js';
import { tituloProduto } from '../normaliza/titulo.js';
import { garantirFichaPT } from '../ingest/traduz.js';

// Fotos dos produtos vivem ao lado das das notas, num subdiretório 'produtos'.
const DIR_FOTOS = path.join(path.dirname(config.uploads.faturas), 'produtos');

const parseJson = (j) => { try { return j ? (typeof j === 'string' ? JSON.parse(j) : j) : null; } catch { return null; } };

// Consulta o CATÁLOGO LOCAL (scrapes Auchan/Continente) por EAN: nome/marca/
// categoria/tamanho — cobre o que o OFF não tem (cervejas, não-alimentares). Sem
// nutrição (o catálogo não a tem). Prefere a linha COM marca.
async function consultarCatalogo(ean) {
  const [[c]] = await getPool().query(
    `SELECT nome, marca, COALESCE(NULLIF(categoria_path,''), categoria) AS categoria, formato AS quantidade, fonte
       FROM catalogo_produto
      WHERE ean = ? AND nome IS NOT NULL AND nome <> ''
      ORDER BY (marca IS NOT NULL AND marca <> '') DESC, id LIMIT 1`,
    [ean],
  );
  return c || null;
}

// Consulta um produto pelo EAN: nossa base → Open Food Facts → catálogo local (e
// GUARDA, item_id NULL). Devolve { encontrado, fonte, nome }. Por /consultar e /foto.
export async function consultarOuGuardar(ean) {
  // Guarda central: um EAN com dígito verificador errado (VLM/foto mal lida)
  // nunca pode entrar na base como chave — envenenava o catálogo e a base local.
  if (!eanValido(ean)) return { encontrado: false, ean_invalido: true };
  const [[ja]] = await getPool().query(
    `SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(off_json,'$.nome')), 'null'), nome) AS nome
       FROM produto_ean WHERE ean = ? AND (off_json IS NOT NULL OR vlm_json IS NOT NULL OR fonte = 'catalogo') ORDER BY id LIMIT 1`,
    [ean],
  );
  if (ja) return { encontrado: true, fonte: 'base', nome: ja.nome || null };
  const off = await consultarOFF(ean);
  if (!off) {
    // OFF não tem (típico em cervejas/álcool) → catálogo local Auchan/Continente.
    const cat = await consultarCatalogo(ean);
    if (!cat) return { encontrado: false };
    try {
      await getPool().query(
        `INSERT INTO produto_ean (ean, item_id, sku_id, nome, marca, quantidade, categoria, fonte)
           VALUES (?,NULL,NULL,?,?,?,?, 'catalogo')
         ON DUPLICATE KEY UPDATE nome=COALESCE(produto_ean.nome, VALUES(nome)), marca=COALESCE(produto_ean.marca, VALUES(marca)),
           quantidade=COALESCE(produto_ean.quantidade, VALUES(quantidade)), categoria=COALESCE(produto_ean.categoria, VALUES(categoria))`,
        [ean, tituloProduto(cat.nome), tituloProduto(cat.marca), cat.quantidade, cat.categoria],
      );
      await guardarNomes(ean, null, [{ nome: cat.nome, origem: 'catalogo' }]);
      await atualizarConteudoFicha(getPool(), ean);
    } catch (e) {
      console.error('[consultarOuGuardar] catálogo:', e.message);
    }
    return { encontrado: true, fonte: 'catalogo', nome: cat.nome || null };
  }
  try {
    await getPool().query(
      `INSERT INTO produto_ean (ean, item_id, sku_id, nome, marca, quantidade, categoria, ingredientes, alergenios, nutricao, nutricao_confirmada, fonte, off_json)
         VALUES (?,NULL,NULL,?,?,?,?,?,?,?,1,?,?)
       ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
         ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), nutricao=VALUES(nutricao), nutricao_confirmada=1, fonte=VALUES(fonte), off_json=VALUES(off_json)`,
      [ean, tituloProduto(off.nome), tituloProduto(off.marca), off.quantidade, off.categoria, off.ingredientes, off.alergenios,
        off.nutricao_100g ? JSON.stringify(off.nutricao_100g) : null, 'off', JSON.stringify(off)],
    );
    await guardarNomes(ean, null, [{ nome: off.nome, origem: 'off' }]);
    await atualizarConteudoFicha(getPool(), ean);
    // OFF pode vir noutra língua → traduz para PT em fundo (não atrasa a resposta)
    garantirFichaPT(getPool(), ean).catch(() => {});
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
  // dados diretos da linha (ex.: vindos do catálogo Auchan/Continente, sem JSON) —
  // nome/marca/categoria/tamanho para mostrar mesmo sem OFF/VLM (cervejas, etc.).
  const base = rows.find((r) => r.nome || r.marca)
    ? (() => { const r = rows.find((x) => x.nome || x.marca); return { nome: r.nome, marca: r.marca, quantidade: r.quantidade, categoria: r.categoria, fonte: r.fonte }; })()
    : null;
  const [fotos] = ean
    ? await getPool().query('SELECT id, ordem FROM produto_foto WHERE ean = ? OR item_id = ? ORDER BY ordem, id', [ean, itemId])
    : itemId
      ? await getPool().query('SELECT id, ordem FROM produto_foto WHERE item_id = ? ORDER BY ordem, id', [itemId])
      : [[]];

  // sem SKU mas com EAN: liga ao SKU pela ficha (produto_ean.sku_id) ou por um
  // item desse EAN — necessário p/ o grupo/alternativas do produto scaneado.
  if (!skuId) {
    skuId = rows.find((r) => r.sku_id)?.sku_id || null;
    if (!skuId && ean) {
      const [[it2]] = await getPool().query('SELECT sku_id FROM item WHERE ean = ? AND sku_id IS NOT NULL LIMIT 1', [ean]);
      skuId = it2?.sku_id || null;
    }
  }
  let generico = null;
  if (skuId) {
    const [[g]] = await getPool().query('SELECT tipo, alimento, categoria, nutricao FROM produto_generico WHERE sku_id = ?', [skuId]);
    if (g) generico = { tipo: g.tipo, alimento: g.alimento, categoria: g.categoria, nutricao_100g: parseJson(g.nutricao) };
    if (!nome) { const [[s]] = await getPool().query('SELECT nome_canonico FROM sku_normalizado WHERE id = ?', [skuId]); nome = s?.nome_canonico || null; }
  }

  const temGenericoNut = !!generico?.nutricao_100g;
  const fonte = vlm && off ? 'ambos' : off ? 'off' : vlm ? 'vlm'
    : temGenericoNut ? 'generico' : base?.fonte === 'catalogo' ? 'catalogo' : null;
  // nutrição "por confirmar": lida só do rótulo por VLM (sem OFF a confirmar)
  const nutricaoProvisoria = !off?.nutricao_100g && rows.some((r) => r.nutricao && r.nutricao_confirmada === 0);
  return { ean, vlm, off, base, generico, skuId, nome, fonte, fotos, nutricao_provisoria: nutricaoProvisoria, existe: rows.length > 0 || temGenericoNut };
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
      // nutrição lida SÓ pelo VLM (sem OFF) fica "por confirmar" — isolada até o
      // operador rever (aba Fichas) ou uma fonte independente (OFF) confirmar.
      const nutConfirmada = off ? 1 : nutricao ? 0 : 1;
      await getPool().query(
        `INSERT INTO produto_ean (ean, sku_id, item_id, nome, marca, quantidade, categoria, ingredientes, alergenios, validade, nutricao, nutricao_confirmada, fonte, vlm_json, off_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE sku_id=COALESCE(VALUES(sku_id),sku_id), item_id=COALESCE(VALUES(item_id),item_id), nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade),
           categoria=VALUES(categoria), ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), validade=VALUES(validade),
           nutricao=VALUES(nutricao), nutricao_confirmada=VALUES(nutricao_confirmada), fonte=VALUES(fonte), vlm_json=VALUES(vlm_json), off_json=VALUES(off_json)`,
        [ean, skuId, itemId, tituloProduto(nome), tituloProduto(off?.marca || vlm?.marca), off?.quantidade || vlm?.quantidade || null, off?.categoria || vlm?.categoria || null,
          off?.ingredientes || vlm?.ingredientes || null, off?.alergenios || vlm?.alergenios || null, vlm?.validade || null,
          nutricao ? JSON.stringify(nutricao) : null, nutConfirmada, fonte, vlm ? JSON.stringify(vlm) : null, off ? JSON.stringify(off) : null],
      );
    } catch (e) { console.error('[produto/identificar] guardar:', e.message); }
    if (ean) atualizarConteudoFicha(getPool(), ean).catch(() => {});

    // EAN escaneado/manual é autoritativo para a IDENTIDADE do item → grava em
    // item.ean. Assim o item sai da worklist "por identificar" (que filtra
    // ean IS NULL) e o EAN fica ligado à linha do talão.
    if (itemId && ean) {
      try { await getPool().query('UPDATE item SET ean = ? WHERE id = ?', [ean, itemId]); }
      catch (e) { console.error('[produto/identificar] item.ean:', e.message); }
    }
    // ficha pode ter vindo noutra língua (OFF) → traduz em fundo
    if (ean) garantirFichaPT(getPool(), ean).catch(() => {});

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

// ALTERNATIVAS SIMILARES (MVP determinístico, sem LLM): produtos do MESMO grupo
// com nutrição, p/ comparar com o produto da ficha ("em vez de carne de vaca, o
// frango: mais proteína, menos saturada"). A nutrição é uniforme por 100 g em
// todas as fontes; o preço vem do histórico. O parecer personalizado fica para o
// passo seguinte (reusa compararProdutosLLM) — aqui é a base factual e barata.
produtoRouter.get('/alternativas', requireAuth, async (req, res) => {
  try {
    const itemId = Number(req.query.item_id) || null;
    const eanQ = String(req.query.ean || '').replace(/\D/g, '') || null;
    const skuId = Number(req.query.sku_id) || null;
    if (!itemId && !eanQ && !skuId) return res.status(400).json({ erro: 'item_id, sku_id ou ean em falta' });
    const info = await consolidarProduto({ itemId, eanQ, skuId });
    const nutAtual = info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null;
    // grupo do produto: do SKU (B1) e, se não houver, derivado do OFF (categorias/
    // food_groups) — assim um produto scaneado nunca comprado ainda tem alternativas.
    let grupo = null;
    if (info.skuId) {
      const [[s]] = await getPool().query('SELECT grupo FROM sku_normalizado WHERE id = ?', [info.skuId]);
      grupo = s?.grupo || null;
    }
    if (!grupo || grupo === 'outros') {
      const g = grupoDe({ foodGroups: info.off?.grupos_alimento, categoria: info.off?.categoria || info.base?.categoria, nome: info.nome });
      if (g && g !== 'outros') grupo = g;
    }
    if (!grupo || grupo === 'outros') return res.json({ grupo, produto: { nome: info.nome, nutricao: nutAtual }, alternativas: [] });

    // GRANULARIDADE: frescos cruzam pelo GRUPO (carne de porco → outras carnes;
    // banana → outras frutas — a categoria do fresco É o item, o útil é variar);
    // processados cruzam pela CATEGORIA do mestre (iogurte → outros iogurtes, não
    // queijo/manteiga). Sinal = produto_generico.tipo. Sem categoria → grupo.
    let mestreCat = null;
    if (info.skuId) {
      const [[m]] = await getPool().query(
        'SELECT m.categoria FROM sku_normalizado s JOIN produto_mestre m ON m.id = s.mestre_id WHERE s.id = ?', [info.skuId]);
      mestreCat = m?.categoria || null;
    }
    const processado = info.generico?.tipo !== 'fresco';
    const QUERY = (porCategoria) => getPool().query(
      `SELECT s.id, s.nome_canonico AS nome, m.corte, m.variedade, m.sabor, m.teor,
              COALESCE(pg.nutricao, (SELECT pe.nutricao FROM item i JOIN produto_ean pe ON pe.ean = i.ean
                 WHERE i.sku_id = s.id AND pe.nutricao IS NOT NULL LIMIT 1)) AS nutricao,
              (SELECT ROUND(AVG(i2.preco_por_base), 2) FROM item i2 WHERE i2.sku_id = s.id AND i2.preco_por_base IS NOT NULL) AS eur_base,
              (SELECT s.unidade_base) AS unidade_base
         FROM sku_normalizado s
         LEFT JOIN produto_mestre m ON m.id = s.mestre_id
         LEFT JOIN produto_generico pg ON pg.sku_id = s.id
        WHERE ${porCategoria ? 'm.categoria = ?' : 's.grupo = ?'} AND s.id <> ?
       HAVING nutricao IS NOT NULL
        LIMIT 30`,
      [porCategoria ? mestreCat : grupo, info.skuId || 0],
    );
    let [cands] = (processado && mestreCat) ? await QUERY(true) : await QUERY(false);
    let nivel = (processado && mestreCat) ? 'categoria' : 'grupo';
    if (nivel === 'categoria' && cands.filter((c) => c.nutricao).length < 2) { [cands] = await QUERY(false); nivel = 'grupo'; }
    // parse + dedup por nome canónico; prioriza os que têm preço no histórico
    const vistos = new Set();
    const alternativas = cands.map((c) => ({
      sku_id: c.id, nome: c.nome, corte: c.corte || null, variedade: c.variedade || null, teor: c.teor || null,
      eur_base: c.eur_base != null ? Number(c.eur_base) : null, unidade_base: c.unidade_base || null,
      nutricao: parseJson(c.nutricao),
    })).filter((a) => {
      const k = a.nome.toLowerCase();
      if (vistos.has(k) || !a.nutricao) return false; vistos.add(k); return true;
    }).sort((a, b) => (b.eur_base != null) - (a.eur_base != null)).slice(0, 6);

    res.json({ grupo, nivel, categoria: mestreCat, produto: { nome: info.nome, nutricao: nutAtual }, alternativas });
  } catch (e) {
    console.error('[produto/alternativas] erro:', e.message);
    res.status(500).json({ erro: 'Falha a obter alternativas' });
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

const normN = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
// Procura um produto JÁ CONHECIDO (SKU com ficha/nutrição) pelo nome, por TOKENS
// com prioridade ao substantivo-cabeça (igual à consulta). Devolve {sku_id, ean}
// do melhor candidato com nutrição — embalado (ean→ficha OFF) ou fresco (genérico).
async function buscarProdutoConhecido(pool, nome) {
  const q = normN(nome).split(' ').filter((t) => t.length >= 2);
  if (!q.length) return null;
  const [skus] = await pool.query('SELECT id, nome_canonico, nome_simplificado FROM sku_normalizado');
  const fortes = [], fracos = [];
  for (const s of skus) {
    const nt = normN(`${s.nome_canonico} ${s.nome_simplificado || ''}`).split(' ').filter(Boolean);
    if (!q.every((qt) => nt.some((w) => tokenCasa(w, qt)))) continue;
    (normN(s.nome_canonico).split(' ')[0].startsWith(q[0]) ? fortes : fracos).push(s);
  }
  for (const s of (fortes.length ? fortes : fracos)) {
    // embalado: EAN com ficha (nutrição OFF/VLM) → abre por EAN
    const [[pe]] = await pool.query(
      `SELECT i.ean FROM item i JOIN produto_ean pe ON pe.ean = i.ean
        WHERE i.sku_id = ? AND pe.nutricao IS NOT NULL LIMIT 1`, [s.id]);
    if (pe?.ean) return { sku_id: s.id, ean: pe.ean, nome: s.nome_canonico };
    // fresco: nutrição típica por SKU
    const [[g]] = await pool.query('SELECT 1 FROM produto_generico WHERE sku_id = ? AND nutricao IS NOT NULL', [s.id]);
    if (g) return { sku_id: s.id, ean: null, nome: s.nome_canonico };
  }
  return null;
}

// Consultar um produto pelo NOME (texto/voz), SEM código de barras. 1.º procura nos
// produtos que JÁ conhecemos (SKU c/ ficha — frescos E embalados, ex.: "queijo
// gouda"); 2.º cria nutrição-típica por LLM para frescos novos ("figo", "fraldinha").
// Embalado desconhecido → encontrado:false (pede rótulo/EAN).
produtoRouter.get('/por-nome', requireAuth, async (req, res) => {
  try {
    const nome = String(req.query.nome || '').trim().slice(0, 120);
    if (nome.length < 2) return res.status(400).json({ erro: 'Escreve o nome do produto' });
    const conhecido = await buscarProdutoConhecido(getPool(), nome);
    if (conhecido) return res.json({ encontrado: true, ...conhecido });
    const gen = await resolverGenericoPorNome(getPool(), nome);
    if (gen?.nutricao_100g && gen.sku_id) {
      return res.json({ encontrado: true, sku_id: gen.sku_id, nome: gen.alimento || nome, tipo: gen.tipo });
    }
    res.json({ encontrado: false, tipo: gen?.tipo || null, nome: gen?.alimento || nome });
  } catch (e) {
    console.error('[produto/por-nome] erro:', e.message);
    res.status(500).json({ erro: 'Falha a consultar o produto por nome' });
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

// BASE LOCAL (réplica no telefone): o conhecimento de produtos acumulado, para o
// scan responder INSTANTÂNEO e OFFLINE. Duas camadas: (1) FICHAS ricas (produto_ean
// + análise: nutrição/ingredientes/parecer) — pequenas, vão SEMPRE completas;
// (2) CATÁLOGO nome→EAN (milhares, sem nutrição) — incremental por cursor de id,
// em chunks. Cresce com o uso: cada consulta externa é persistida pelo
// consultarOuGuardar → entra na próxima sincronização.
produtoRouter.get('/base-local', requireAuth, async (req, res) => {
  try {
    const desdeId = Number(req.query.catalogo_desde_id) || 0;
    const limite = Math.min(Math.max(Number(req.query.limite) || 5000, 100), 10000);
    const [fichas] = await getPool().query(
      `SELECT pe.ean,
              MAX(pe.nome) AS nome, MAX(pe.marca) AS marca, MAX(pe.quantidade) AS quantidade,
              MAX(pe.categoria) AS categoria, MAX(pe.ingredientes) AS ingredientes,
              MAX(pe.alergenios) AS alergenios, MAX(CAST(pe.nutricao AS CHAR)) AS nutricao,
              MIN(pe.nutricao_confirmada) AS nutricao_confirmada,
              MAX(pe.fonte) AS fonte, MAX(CAST(pa.analise AS CHAR)) AS analise
         FROM produto_ean pe
         LEFT JOIN produto_analise pa ON pa.ean = pe.ean
        WHERE pe.ean IS NOT NULL AND pe.ean <> ''
        GROUP BY pe.ean`,
    );
    const [catalogo] = await getPool().query(
      `SELECT id, ean, nome, marca, formato AS quantidade
         FROM catalogo_produto
        WHERE ean IS NOT NULL AND ean <> '' AND id > ?
        ORDER BY id
        LIMIT ?`,
      [desdeId, limite],
    );
    const ultimo = catalogo.length ? catalogo[catalogo.length - 1].id : desdeId;
    res.json({
      fichas,
      catalogo: catalogo.map(({ id, ...c }) => c),
      catalogo_cursor: ultimo,
      catalogo_fim: catalogo.length < limite,
    });
  } catch (e) {
    console.error('[produto/base-local] erro:', e.message);
    res.status(500).json({ erro: 'Falha a sincronizar a base local' });
  }
});

// "Despensa" da casa: os produtos que conhecemos (com EAN), por ordem de compra
// (data) decrescente. Dedup por EAN, mantendo a compra mais recente.
produtoRouter.get('/despensa', requireAuth, async (req, res) => {
  try {
    const [rows] = await getPool().query(`
      SELECT pe.ean, pe.item_id, pe.id AS pe_id,
             COALESCE(s.nome_canonico, i.descricao_original, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pe.off_json,'$.nome')), 'null'), pe.nome) AS nome,
             COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pe.off_json,'$.marca')), 'null'), pe.marca) AS marca,
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

// Produtos que PRECISAM de fotos (embalados sem EAN, não-frescos) — worklist de
// identificação, agrupada por LOJA e ordenada por NOME (dedup por loja+produto).
produtoRouter.get('/por-identificar', requireAuth, async (req, res) => {
  try {
    const [itens] = await getPool().query(`
      SELECT MAX(i.id) AS item_id, MAX(i.sku_id) AS sku_id,
             MAX(COALESCE(s.nome_canonico, i.descricao_original)) AS produto,
             i.descricao_original AS descricao,
             CAST(SUBSTRING_INDEX(GROUP_CONCAT(i.preco_liquido ORDER BY i.id DESC), ',', 1) AS DECIMAL(10,2)) AS preco,
             MAX(f.id) AS fatura_id, MAX(f.data_compra) AS data, COALESCE(l.cadeia, l.nome) AS loja
        FROM item i
        LEFT JOIN sku_normalizado s ON s.id = i.sku_id
        LEFT JOIN produto_generico pg ON pg.sku_id = i.sku_id
        JOIN fatura f ON f.id = i.fatura_id
        JOIN loja l ON l.id = f.loja_id
       WHERE i.is_non_product = 0
         AND i.ean IS NULL
         AND (pg.tipo IS NULL OR pg.tipo <> 'fresco')
         -- identificado se QUALQUER compra com o mesmo nome E na mesma cadeia já
         -- ganhou EAN **ou uma ficha com dados** (foto/VLM ou OFF). Identificar uma
         -- "Salada Gourmet" do Continente vale para todas as do Continente com esse
         -- nome; entre cadeias não (pode ser outra marca-própria). A ficha por foto
         -- (sem EAN — ex.: alperces desidratados a granel) também resolve: o produto
         -- já tem nutrição/rótulo, não precisa de voltar à worklist.
         AND NOT EXISTS (
           SELECT 1 FROM produto_ean pe
             JOIN item i2 ON i2.id = pe.item_id
             JOIN fatura f2 ON f2.id = i2.fatura_id
             JOIN loja l2 ON l2.id = f2.loja_id
            WHERE (pe.ean IS NOT NULL OR pe.vlm_json IS NOT NULL OR pe.off_json IS NOT NULL OR pe.nutricao IS NOT NULL)
              AND i2.descricao_original = i.descricao_original
              AND COALESCE(l2.cadeia, l2.nome) = COALESCE(l.cadeia, l.nome))
         -- REUSO POR MESMO EAN: se a descrição deste talão é nome conhecido de UM ÚNICO
         -- EAN (produto_nome), é esse produto sem ambiguidade → não re-identificar. Se o
         -- mesmo nome se liga a VÁRIOS EANs (genérico/marca-própria de lojas diferentes,
         -- ex.: "LEITE MEIO GORDO" ou "IOGURTE GREGO NATURAL" com EANs distintos por
         -- cadeia) → ambíguo, FICA na lista. É o critério do mesmo EAN: "CARLSBERG LATA"
         -- (1 EAN) e "...TP" (outro EAN) resolvem cada um o seu; "SERRAMEL ROSMANINHO" e
         -- "SERRAMEL MEL ROSMANINHO" partilham o mesmo EAN.
         AND (SELECT COUNT(DISTINCT pn.ean) FROM produto_nome pn
               WHERE pn.nome = i.descricao_original AND pn.ean IS NOT NULL) <> 1
       GROUP BY COALESCE(l.cadeia, l.nome), i.descricao_original
       ORDER BY loja, produto`);
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
    const skuId = Number(req.query.sku_id) || null;
    const forcar = String(req.query.forcar || '') === '1';
    if (!itemId && !eanQ && !skuId) return res.status(400).json({ erro: 'item_id, sku_id ou ean em falta' });

    const info = await consolidarProduto({ itemId, eanQ, skuId });
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
    const skuId = Number(req.query.sku_id) || null;
    if (!itemId && !eanQ && !skuId) return res.status(400).json({ erro: 'item_id, sku_id ou ean em falta' });

    const [[p]] = await getPool().query('SELECT id, nome, resumo FROM perfil_membro WHERE ativo = 1 LIMIT 1');
    if (!p) return res.json({ perfil: null });
    const resumo = typeof p.resumo === 'string' ? JSON.parse(p.resumo) : p.resumo;

    const info = await consolidarProduto({ itemId, eanQ, skuId });
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

    // CACHE da avaliação LLM (o maior custo recorrente: corria a cada abertura da
    // ficha). Chave perfil+produto; invalidação por HASH do input — editar o
    // perfil ou a nutrição muda o hash e re-gera. Alertas ficam determinísticos
    // (calculados sempre, acima). ?forcar=1 ignora a cache.
    const chaveProd = info.ean || (info.skuId ? `sku:${info.skuId}` : null);
    const chaveCache = chaveProd ? `perfil:${p.id}:${chaveProd}`.slice(0, 64) : null;
    const hash = createHash('sha1').update(JSON.stringify([produto, resumo])).digest('hex').slice(0, 16);
    const forcar = String(req.query.forcar || '') === '1';
    if (chaveCache && !forcar) {
      const [[c]] = await getPool().query('SELECT analise FROM produto_analise WHERE ean = ?', [chaveCache]);
      const j = c?.analise ? parseJson(c.analise) : null;
      if (j?.hash === hash && j.avaliacao) {
        return res.json({ perfil: p.nome, alertas, avaliacao: j.avaliacao, custo: 0, cacheada: true });
      }
    }

    let avaliacao = null, custo = 0;
    try {
      const r = await avaliarParaPerfil(produto, resumo);
      avaliacao = r.avaliacao;
      custo = r.custo;
    } catch (e) {
      console.error('[produto/personalizado] avaliar:', e.message);
    }
    if (chaveCache && avaliacao) {
      await getPool()
        .query('INSERT INTO produto_analise (ean, analise, modelo) VALUES (?,?,?) ON DUPLICATE KEY UPDATE analise=VALUES(analise), modelo=VALUES(modelo), criado_em=CURRENT_TIMESTAMP',
          [chaveCache, JSON.stringify({ avaliacao, hash }), 'modelConsulta'])
        .catch((e) => console.error('[produto/personalizado] cache:', e.message));
    }
    res.json({ perfil: p.nome, alertas, avaliacao, custo });
  } catch (e) {
    console.error('[produto/personalizado] erro:', e.message);
    res.status(500).json({ erro: 'Falha na avaliação personalizada' });
  }
});

// COMPARAR 2-6 produtos (na prateleira): junta a ficha de cada EAN + o perfil
// ativo (se houver) → o LLM rankeia e explica. Alergénio do perfil num produto
// força "evitar" DETERMINISTICAMENTE (a regra dura nunca fica nas mãos do LLM).
produtoRouter.post('/comparar', requireAuth, async (req, res) => {
  try {
    const eans = [...new Set((Array.isArray(req.body?.eans) ? req.body.eans : [])
      .map((e) => String(e).replace(/\D/g, '')).filter((e) => e.length >= 8))].slice(0, 6);
    if (eans.length < 2) return res.status(400).json({ erro: 'São precisos pelo menos 2 produtos.' });

    const [[p]] = await getPool().query('SELECT id, nome, resumo FROM perfil_membro WHERE ativo = 1 LIMIT 1');
    const resumo = p ? (typeof p.resumo === 'string' ? JSON.parse(p.resumo) : p.resumo) : null;

    const produtos = [];
    for (const ean of eans) {
      const info = await consolidarProduto({ eanQ: ean });
      const prod = {
        ean,
        nome: info.off?.nome || info.vlm?.nome || info.base?.nome || info.generico?.alimento || info.nome || ean,
        marca: info.off?.marca || info.vlm?.marca || info.base?.marca || null,
        quantidade: info.off?.quantidade || info.vlm?.quantidade || info.base?.quantidade || null,
        categoria: info.off?.categoria || info.vlm?.categoria || info.generico?.categoria || null,
        ingredientes: info.vlm?.ingredientes || info.off?.ingredientes || null,
        alergenios: info.off?.alergenios || info.vlm?.alergenios || null,
        nutricao_100g: info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null,
        nutriscore: info.off?.nutriscore || null,
        nova: info.off?.nova ?? null,
      };
      prod.dados_incompletos = !prod.nutricao_100g;
      if (info.nutricao_provisoria) prod.nutricao_por_confirmar = true; // lida por IA, sem fonte independente
      prod.alertas = resumo ? alertasDoPerfil(prod, resumo) : [];
      produtos.push(prod);
    }

    const { comparacao, custo } = await compararProdutosLLM(
      produtos.map(({ alertas, ...resto }) => (alertas.length ? { ...resto, alertas_perfil: alertas } : resto)),
      resumo,
    );
    // regra dura: alergénio do perfil → "evitar", digam o que disserem os pontos
    const ranking = (comparacao?.ranking || []).map((r) => {
      const pr = produtos.find((x) => x.ean === String(r.ean));
      return pr?.alertas?.length ? { ...r, veredicto: 'evitar', alertas: pr.alertas } : r;
    });
    res.json({
      perfil: p?.nome || null,
      resumo: comparacao?.resumo || null,
      ranking,
      produtos: produtos.map(({ ean, nome, marca, quantidade, dados_incompletos }) => ({ ean, nome, marca, quantidade, dados_incompletos })),
      custo,
    });
  } catch (e) {
    console.error('[produto/comparar] erro:', e.message);
    res.status(500).json({ erro: 'Falha ao comparar os produtos' });
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

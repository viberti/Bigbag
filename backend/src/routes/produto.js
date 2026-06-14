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
import { POR_IDENTIFICAR_SQL } from '../criterios.js';
import { extrairProdutoFotos, consultarOFF, consultarCatalogo, analisarProduto, caracterizarProdutoNome, eanValido, lerEanDeFoto, analisarFotoProduto, buscarOffPorNome, garantirGenericoSku } from '../ingest/produto.js';
import { atualizarConteudoFicha } from '../normaliza/conteudo.js';
import { grupoDe, grupoDeNome, tokenCasa, singularizar, norm as normN, tipoConsumidor } from '../normaliza/categoria.js';
import { facetasDe } from '../normaliza/facetas.js';
import { fundirFichaEan } from '../normaliza/fichaEan.js';
import { nutricaoPlausivel } from '../normaliza/validadores.js';
import { alertasDoPerfil, avaliarParaPerfil, compararProdutosLLM } from '../ingest/perfil.js';
import { tituloProduto } from '../normaliza/titulo.js';
import { garantirFichaPT } from '../ingest/traduz.js';
import { resolverItensLista } from './lista.js';
import { matchImagemB64 } from '../normaliza/matchImagem.js';
import { mestrePorEan } from '../normaliza/mestreEan.js';
import { gerarThumbCatalogo } from '../ingest/thumbCatalogo.js';

// Fotos dos produtos vivem ao lado das das notas, num subdiretório 'produtos'.
const DIR_FOTOS = path.join(path.dirname(config.uploads.faturas), 'produtos');

// Trunca um valor ao tamanho da coluna. Guarda dura: o OFF/VLM podem devolver
// strings mais longas que a coluna (ex.: a hierarquia de categorias do OFF, ou
// uma validade verbosa do VLM) e um "Data too long" abortava o INSERT INTEIRO,
// perdendo a ficha toda. Truncar é sempre melhor que perder a identificação.
const lim = (s, n) => (s == null ? null : String(s).slice(0, n));

const parseJson = (j) => { try { return j ? (typeof j === 'string' ? JSON.parse(j) : j) : null; } catch { return null; } };

// (consultarCatalogo vive em ingest/produto.js — partilhado com o enriquecimento;
// desde a 047 devolve também NUTRIÇÃO oficial de loja + ingredientes do Auchan.)

// Consulta um produto pelo EAN: nossa base → Open Food Facts → catálogo local (e
// GUARDA, item_id NULL). Devolve { encontrado, fonte, nome }. Por /consultar e /foto.
// Melhor nome PORTUGUÊS do CATÁLOGO para um EAN (ou null). O catálogo (lojas PT)
// tem nomes limpos e em português para o MESMO EAN que o OFF traz noutra língua —
// caso real: Barilla Penne Rigate, EAN 8076802085738, que está "Massa Penne Rigate
// Barilla" no Continente mas "Penne Rigate No. 73 Durum Wheat…" no OFF. Como
// consultamos OFF primeiro, o inglês ganhava. Esta função dá o nome de loja PT
// para PREFERI-LO ao OFF (melhor que traduzir o inglês). Prioridade: nome_pt
// (léxico Mercadona) → loja PT (Continente é o mais limpo) → null (só fontes
// estrangeiras como lidl-fr ou Mercadona-ES sem nome_pt → deixa OFF+tradução).
export async function consultarOuGuardar(ean, { traduzir = false } = {}) {
  // RESOLVEDOR ÚNICO (2026-06-13): toda a escrita da ficha passa pela FUSÃO de
  // fontes (normaliza/fichaEan.js — tabela de prioridades única, proveniência e
  // divergências em produto_ean.fusao). OFF live só quando nada local resolve.
  // traduzir: espera a tradução PT do nome estrangeiro (scan-para-lista).
  if (!eanValido(ean)) return { encontrado: false, ean_invalido: true };
  const pool = getPool();
  const [[atual]] = await pool.query('SELECT * FROM produto_ean WHERE ean = ? ORDER BY id LIMIT 1', [ean]);

  let r = await fundirFichaEan(pool, ean, { atual });
  if (!r.ficha.nome) {
    // nada local com substância → OFF (dump→live; o consultarOFF é local-first e cura o dump)
    const offLive = await consultarOFF(ean);
    if (offLive) r = await fundirFichaEan(pool, ean, { atual, extra: { off: offLive } });
  }
  if (!r.ficha.nome) {
    // EAN que não resolve em lado nenhum → REGISTAR como pendente (não descartar).
    await pool.query(
      "INSERT INTO produto_ean (ean, item_id, sku_id, fonte) VALUES (?, NULL, NULL, 'pendente') ON DUPLICATE KEY UPDATE ean = ean",
      [ean]).catch((e) => console.error('[ean-pendente]', e.message));
    return { encontrado: false, registado: true };
  }

  // gravar SÓ se as fontes mudaram (fontes_hash) ou a ficha ainda não tem nome
  const hashAtual = (() => { try { return JSON.parse(atual?.fusao || 'null')?.fontes_hash; } catch { return null; } })();
  if (!(atual?.nome && hashAtual === r.fusao.fontes_hash)) {
    const f = r.ficha;
    try {
      await pool.query(
        `INSERT INTO produto_ean (ean, item_id, sku_id, nome, marca, quantidade, categoria, ingredientes, alergenios, validade, nutricao, nutricao_confirmada, fonte, off_json, fusao)
           VALUES (?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
           ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), validade=COALESCE(VALUES(validade), validade),
           nutricao=VALUES(nutricao), nutricao_confirmada=VALUES(nutricao_confirmada), fonte=VALUES(fonte),
           off_json=COALESCE(VALUES(off_json), off_json), fusao=VALUES(fusao)`,
        [ean, lim(f.nome, 200), lim(f.marca, 120), lim(f.quantidade, 60), lim(f.categoria, 255),
          f.ingredientes, f.alergenios, lim(f.validade, 60),
          f.nutricao ? JSON.stringify(f.nutricao) : null, f.nutricao_confirmada,
          (r.fusao.proveniencia.nome || 'fusao').slice(0, 10),
          r.off ? JSON.stringify(r.off) : null, JSON.stringify(r.fusao)],
      );
      await guardarNomes(ean, null, [{ nome: f.nome, origem: (r.fusao.proveniencia.nome || 'fusao').slice(0, 20) }]);
      await atualizarConteudoFicha(pool, ean);
    } catch (e) { console.error('[consultarOuGuardar] gravar fusão:', e.message); }
  }

  // tradução LLM fica FORA da fusão: só quando o nome final não é PT
  let nome = r.ficha.nome;
  if (r.nomeEstrangeiro) {
    if (traduzir) nome = (await garantirFichaPT(pool, ean)) || nome;
    else garantirFichaPT(pool, ean).catch(() => {});
  }
  return { encontrado: true, fonte: r.fusao.proveniencia.nome || 'fusao', nome };
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
  // foto de CATÁLOGO do produto (hotlink; ~52k disponíveis): dá cara à ficha
  // mesmo sem fotos do utilizador. Por EAN direto, ou pelo ean_inferido (PD).
  let imagemCatalogo = null;
  if (ean) {
    const [[img]] = await getPool().query(
      `SELECT imagem_url FROM catalogo_produto
        WHERE (ean = ? OR ean_inferido = ?) AND imagem_url IS NOT NULL AND imagem_url <> '' LIMIT 1`, [ean, ean]);
    imagemCatalogo = img?.imagem_url || null;
  }
  return { ean, vlm, off, base, generico, skuId, nome, fonte, fotos, imagem_catalogo: imagemCatalogo, nutricao_provisoria: nutricaoProvisoria, existe: rows.length > 0 || temGenericoNut };
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
  // 2) sem SKU: caracteriza; se tem NUTRIÇÃO DE CLASSE (fresco ou básico — arroz,
  // pão), cria entrada de catálogo (não se perde). Processado-de-marca → sem nutrição.
  const { dados, custo } = await caracterizarProdutoNome(limpo);
  const tipoClasse = ['fresco', 'basico'].includes(dados.tipo) ? dados.tipo : null;
  if (!tipoClasse) return { tipo: 'processado', alimento: dados.alimento || null, nutricao_100g: null, custo, sku_id: null };
  const nomeCanon = (dados.alimento || limpo).replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 160);
  const [ins] = await pool.query('INSERT INTO sku_normalizado (nome_canonico) VALUES (?)', [nomeCanon]);
  await pool.query(
    `INSERT INTO produto_generico (sku_id, tipo, alimento, categoria, nutricao, modelo) VALUES (?,?,?,?,?,?)`,
    [ins.insertId, tipoClasse, dados.alimento || null, dados.categoria || null,
      dados.nutricao_100g ? JSON.stringify(dados.nutricao_100g) : null, config.openrouter.modelConsulta],
  );
  return { tipo: tipoClasse, alimento: dados.alimento || null, categoria: dados.categoria || null, nutricao_100g: dados.nutricao_100g || null, custo, sku_id: ins.insertId, criado: true };
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

    // nutrição SÓ-VLM passa o gate de plausibilidade (revisão 3.6): leitura OCR
    // absurda (kcal>950, açúcar>hidratos…) é DESCARTADA em vez de entrar na ficha.
    const nutVlm = vlm?.nutricao_100g && nutricaoPlausivel(vlm.nutricao_100g) ? vlm.nutricao_100g : null;
    if (vlm?.nutricao_100g && !nutVlm) console.warn('[identificar] nutrição VLM implausível descartada', ean || '');
    let nutricao = off?.nutricao_100g || nutVlm || null;
    // 3.ª fonte: NUTRIÇÃO oficial de loja no catálogo (047, Auchan) — confirmada.
    let nutCatalogo = false;
    if (ean && (!nutricao || Object.values(nutricao).every((v) => v == null))) {
      const cat = await consultarCatalogo(ean);
      if (cat?.nutricao) { nutricao = cat.nutricao; nutCatalogo = true; }
    }
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
      // RESOLVEDOR ÚNICO (2026-06-13): a ficha é a FUSÃO de todas as fontes, com o
      // VLM (fotos do dono) e o OFF desta chamada como extras. A tabela de
      // prioridades vive em normaliza/fichaEan.js; proveniência em .fusao.
      if (ean) {
        const [[atualPE]] = await getPool().query('SELECT * FROM produto_ean WHERE ean = ? ORDER BY id LIMIT 1', [ean]);
        const rf = await fundirFichaEan(getPool(), ean, { atual: atualPE, extra: { off: off || undefined, vlm: vlm || undefined } });
        const f = rf.ficha;
        await getPool().query(
          `INSERT INTO produto_ean (ean, sku_id, item_id, nome, marca, quantidade, categoria, ingredientes, alergenios, validade, nutricao, nutricao_confirmada, fonte, vlm_json, off_json, fusao)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE sku_id=COALESCE(VALUES(sku_id),sku_id), item_id=COALESCE(VALUES(item_id),item_id), nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade),
             categoria=VALUES(categoria), ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), validade=COALESCE(VALUES(validade), validade),
             nutricao=VALUES(nutricao), nutricao_confirmada=VALUES(nutricao_confirmada), fonte=VALUES(fonte),
             vlm_json=COALESCE(VALUES(vlm_json), vlm_json), off_json=COALESCE(VALUES(off_json), off_json), fusao=VALUES(fusao)`,
          [ean, skuId, itemId, lim(f.nome || nome, 200), lim(f.marca, 120), lim(f.quantidade, 60), lim(f.categoria, 255),
            f.ingredientes, f.alergenios, lim(f.validade, 60),
            f.nutricao ? JSON.stringify(f.nutricao) : null, f.nutricao_confirmada,
            (rf.fusao.proveniencia.nome || 'fusao').slice(0, 10),
            vlm ? JSON.stringify(vlm) : null, rf.off ? JSON.stringify(rf.off) : null, JSON.stringify(rf.fusao)],
        );
        nutricao = f.nutricao || nutricao; // a resposta da rota reflete a fusão
      } else {
        // SEM EAN (fresco/ilegível): mantém a gravação simples ligada ao item
        const nutConfirmada = off ? 1 : nutricao ? 0 : 1;
        await getPool().query(
          `INSERT INTO produto_ean (ean, sku_id, item_id, nome, marca, quantidade, categoria, ingredientes, alergenios, validade, nutricao, nutricao_confirmada, fonte, vlm_json, off_json)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [null, skuId, itemId, lim(tituloProduto(nome), 200), lim(tituloProduto(off?.marca || vlm?.marca), 120), lim(off?.quantidade || vlm?.quantidade || null, 60), lim(off?.categoria || vlm?.categoria || null, 255),
            off?.ingredientes || vlm?.ingredientes || null, off?.alergenios || vlm?.alergenios || null, lim(vlm?.validade || null, 60),
            nutricao ? JSON.stringify(nutricao) : null, nutConfirmada, fonte, vlm ? JSON.stringify(vlm) : null, off ? JSON.stringify(off) : null],
        );
      }
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

// ── HISTÓRICO de produtos CONSULTADOS ────────────────────────────────────────
// Cada ficha aberta regista o produto (sinal de interesse). Guardamos TODOS — uma
// linha por produto (chave deduplica: EAN > SKU > nome normalizado), com nº de
// consultas e recência. A tela mostra os mais recentes; o resto fica registado.
function chaveHistorico({ ean, sku_id, nome }) {
  const e = String(ean || '').replace(/\D/g, '');
  if (eanValido(e)) return `e:${e}`;
  if (sku_id) return `s:${sku_id}`;
  const n = normN(nome || '');
  return n ? `n:${n}` : null;
}
produtoRouter.post('/historico', requireAuth, async (req, res) => {
  try {
    const { ean = null, sku_id = null, nome = '', marca = null } = req.body || {};
    if (!nome) return res.status(400).json({ erro: 'nome em falta' });
    const chave = chaveHistorico({ ean, sku_id, nome });
    if (!chave) return res.status(400).json({ erro: 'sem chave' });
    const eanLimpo = String(ean || '').replace(/\D/g, '');
    await getPool().query(
      `INSERT INTO historico_produto (utilizador, chave, ean, sku_id, nome, marca)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE n_consultas = n_consultas + 1, ultima_em = CURRENT_TIMESTAMP,
         nome = VALUES(nome), marca = COALESCE(VALUES(marca), marca),
         ean = COALESCE(VALUES(ean), ean), sku_id = COALESCE(VALUES(sku_id), sku_id)`,
      [req.user.id, chave, eanValido(eanLimpo) ? eanLimpo : null, Number(sku_id) || null,
        String(nome).slice(0, 255), marca ? String(marca).slice(0, 140) : null]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[produto/historico POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a registar histórico' });
  }
});
produtoRouter.get('/historico', requireAuth, async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 10, 1), 100);
    const [produtos] = await getPool().query(
      `SELECT ean, sku_id, nome, marca, n_consultas, ultima_em, primeira_em
       FROM historico_produto WHERE utilizador = ? ORDER BY ultima_em DESC LIMIT ${limite}`,
      [req.user.id]);
    const [[c]] = await getPool().query('SELECT COUNT(*) total FROM historico_produto WHERE utilizador = ?', [req.user.id]);
    res.json({ produtos, total: c.total });
  } catch (e) {
    console.error('[produto/historico GET] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar histórico' });
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
    // DIETA: iguais comparam-se com iguais (dono, 2026-06-13 — caso Felicia sem
    // glúten). Um sem-glúten só tem alternativas sem-glúten (para um celíaco, a
    // massa normal NÃO é alternativa); e o normal não recebe os de dieta (prior
    // do simples). Igualdade do CONJUNTO de facetas de dieta, nos dois sentidos.
    // Lista vazia é honesta: "sem iguais para comparar" > comparação enganosa.
    // nome p/ facetas: info.nome e null em EAN-sem-item — usar a cascata da ficha
    const nomeFacetas = info.nome || info.off?.nome || info.vlm?.nome || info.base?.nome || '';
    const dietaAtual = facetasDe(nomeFacetas).dieta;
    const mesmaDieta = (nome) => {
      const d = facetasDe(nome || '').dieta;
      return d.size === dietaAtual.size && [...d].every((x) => dietaAtual.has(x));
    };
    cands = cands.filter((c) => mesmaDieta(c.nome));
    // TIPO saliente: massa compara com massa, nao com ketchup/azeite (o grupo
    // mercearia e um saco de secos). Mesmo recorte da lista (tipoConsumidor).
    const tipoAtual = tipoConsumidor(grupo, nomeFacetas, info.base?.marca || info.off?.marca || null);
    if (['massa', 'pao', 'cereais', 'conservas', 'tomate'].includes(tipoAtual)) {
      cands = cands.filter((c) => tipoConsumidor(grupo, c.nome, null) === tipoAtual);
    }
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

    // FALLBACK AO CATÁLOGO (dono, 2026-06-13 — caso Felicia): a casa pode não ter
    // iguais (ex.: massas sem glúten), mas as LOJAS têm (55 no catálogo, muitas
    // c/ nutrição oficial). Mesmos gates (dieta igual + tipo saliente); preferem-se
    // linhas com nutrição; preço = preco_por_base de CATÁLOGO, marcado origem
    // 'catalogo' (referência, nunca facto — regra do preço de catálogo).
    if (alternativas.length < 2) {
      const [catCands] = await getPool().query(
        `SELECT nome, marca, fonte, preco_por_base, unidade_base, formato, nutricao
           FROM catalogo_produto
          WHERE nome IS NOT NULL AND nome <> '' AND nutricao IS NOT NULL
          LIMIT 20000`);
      const vistosCat = new Set(alternativas.map((a) => a.nome.toLowerCase()));
      const doCatalogo = [];
      for (const c of catCands) {
        if (!mesmaDieta(c.nome)) continue;
        if (['massa', 'pao', 'cereais', 'conservas', 'tomate'].includes(tipoAtual) && tipoConsumidor(grupo, c.nome, c.marca) !== tipoAtual) continue;
        if (!['massa', 'pao', 'cereais', 'conservas', 'tomate'].includes(tipoAtual) && grupoDeNome(c.nome) !== grupo) continue;
        const k = c.nome.toLowerCase();
        if (vistosCat.has(k) || k === String(nomeFacetas).toLowerCase()) continue;
        vistosCat.add(k);
        doCatalogo.push({
          sku_id: null, nome: c.nome, marca: c.marca || null, origem: 'catalogo', fonte: c.fonte,
          eur_base: c.preco_por_base != null ? Number(c.preco_por_base) : null,
          unidade_base: c.unidade_base || null, formato: c.formato || null, nutricao: parseJson(c.nutricao),
        });
        if (alternativas.length + doCatalogo.length >= 6) break;
      }
      alternativas.push(...doCatalogo);
    }
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
    // ?pt=1 (scan-para-lista) → espera a tradução PT antes de responder o nome.
    const traduzir = req.query.pt === '1' || req.query.pt === 'true';
    res.json({ ean, ...(await consultarOuGuardar(ean, { traduzir })) });
  } catch (e) {
    console.error('[produto/consultar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a consultar o produto' });
  }
});

// normN = norm de normaliza/categoria.js (unificação 2026-06-13)
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
    (singularizar(normN(s.nome_canonico).split(' ')[0]).startsWith(singularizar(q[0])) ? fortes : fracos).push(s);
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

// BUSCAR POR FOTO (match-por-imagem): vetoriza a foto do produto e procura no
// Qdrant os mais parecidos no catálogo vetorizado. Devolve candidatos com
// nome/marca/imagem + score de cosseno — o match é VISUAL (não exato como o EAN),
// por isso a UI mostra opções para CONFIRMAR, não abre o 1.º cego.
produtoRouter.post('/match-foto', requireAuth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta a foto' });
    const cands = await matchImagemB64(req.file.buffer.toString('base64'), { k: 15, limiar: 0 });
    // resolve nome/marca/imagem dos melhores EM PARALELO (o matcher já fez dedup por
    // EAN; o map preserva a ordem por score). Sequencial somava ~1s; paralelo ~200ms.
    const out = await Promise.all(cands.slice(0, 6).map(async (c) => {
      const m = await mestrePorEan(getPool(), c.ean).catch(() => null);
      // imagem = miniatura RECORTADA da foto que casou (id do ponto Qdrant); se não
      // houver id, cai na imagem do CDN do catálogo (sem recorte).
      const imagem = c.id ? `/api/produto/foto-catalogo/${c.id}` : (m?.imagem || null);
      return { ean: c.ean, score: c.score, fonte: c.fonte, nome: m?.nomes?.[0] || null, marca: m?.marca || null, imagem };
    }));
    res.json({ candidatos: out });
  } catch (e) {
    console.error('[produto/match-foto] erro:', e.message);
    res.status(503).json({ erro: 'Busca por foto indisponível' });
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
      // nome_pt (Mercadona ES) preferido → a base local do telefone guarda o nome PT
      // (scan não traz "Yogur Griego"); restantes catálogos têm nome_pt NULL → nome original.
      `SELECT id, ean, COALESCE(NULLIF(nome_pt,''), nome) AS nome, marca, formato AS quantidade
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

// "Despensa" = inventário do que a casa TEM, alimentado por SCAN (migração 049).
// Já NÃO deriva das compras (decisão do dono, 2026-06-12: o que se comprou não diz
// o que ainda está em casa). Partilhada; ordenada pelo scan mais recente.
produtoRouter.get('/despensa', requireAuth, async (req, res) => {
  try {
    const mercado = req.query.mercado || null;
    const [rows] = await getPool().query(
      `SELECT ean, nome, marca, validade, atualizado_em AS data FROM despensa ORDER BY atualizado_em DESC, id DESC`);
    const limparVal = (v) => { const s = String(v ?? '').trim(); return s && !/^null$/i.test(s) ? s : null; };
    // MESMO enriquecimento da lista de compras (categoria/secção, marca, tamanho,
    // preço) → a despensa mostra-se com o mesmo formato rico. id = ean (único).
    const itens = rows.map((r) => ({ id: r.ean, nome: r.nome, ean: r.ean, estado: 'ativo', quantidade: 1, marca_scan: r.marca, validade: limparVal(r.validade), data: r.data }));
    await resolverItensLista(getPool(), itens, mercado, { leve: true }); // inventário: salta a estimativa de preço pelo irmão (~1,7s)
    for (const it of itens) { if (!it.marca) it.marca = it.marca_scan || null; delete it.marca_scan; }
    res.json({ produtos: itens });
  } catch (e) {
    console.error('[produto/despensa] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar a despensa' });
  }
});

// Põe um produto na despensa (por scan, ao fazer a lista). Upsert por EAN: re-scan
// não duplica, só atualiza o "visto agora". nome/marca/validade completam-se da
// ficha do EAN quando não vêm no pedido (o scan-para-lista já resolve o nome PT).
produtoRouter.post('/despensa', requireAuth, async (req, res) => {
  try {
    const ean = String(req.body?.ean || '').replace(/\D/g, '');
    if (!eanValido(ean)) return res.status(400).json({ erro: 'EAN inválido' });
    let nome = String(req.body?.nome || '').trim().slice(0, 200) || null;
    let marca = String(req.body?.marca || '').trim().slice(0, 120) || null;
    let validade = null;
    // completa pela ficha guardada (se houver) — nome PT, marca, validade
    const [[pe]] = await getPool().query(
      `SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(off_json,'$.nome')),'null'), nome) AS nome,
              COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(off_json,'$.marca')),'null'), marca) AS marca,
              NULLIF(validade,'null') AS validade
         FROM produto_ean WHERE ean = ? ORDER BY id LIMIT 1`, [ean]);
    if (pe) { nome = nome || pe.nome || null; marca = marca || pe.marca || null; validade = pe.validade || null; }
    await getPool().query(
      `INSERT INTO despensa (ean, nome, marca, validade, utilizador) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE nome=COALESCE(VALUES(nome), nome), marca=COALESCE(VALUES(marca), marca),
         validade=COALESCE(VALUES(validade), validade), utilizador=VALUES(utilizador), atualizado_em=CURRENT_TIMESTAMP`,
      [ean, nome, marca, validade, req.user.id]);
    res.json({ ok: true, ean, nome });
  } catch (e) {
    console.error('[produto/despensa POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a guardar na despensa' });
  }
});

// Tira um produto da despensa (já consumido / enganou-se no scan).
produtoRouter.delete('/despensa/:ean', requireAuth, async (req, res) => {
  try {
    const ean = String(req.params.ean || '').replace(/\D/g, '');
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    await getPool().query('DELETE FROM despensa WHERE ean = ?', [ean]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[produto/despensa DELETE] erro:', e.message);
    res.status(500).json({ erro: 'Falha a remover' });
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
       WHERE ${POR_IDENTIFICAR_SQL}
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

// Serve a MINIATURA NORMALIZADA (recortada + quadrada) de uma imagem de catálogo,
// por id da linha de catálogo. Serve a cache do disco; gera on-the-fly se faltar
// (e cacheia). Usada pelo carrossel do "buscar por foto". 7 dias de cache (estável).
produtoRouter.get('/foto-catalogo/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).end();
    const ficheiro = await gerarThumbCatalogo(id);
    if (!ficheiro) return res.status(404).end();
    res.type('image/webp');
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(ficheiro, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (e) {
    console.error('[foto-catalogo] erro:', e.message);
    if (!res.headersSent) res.status(500).end();
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

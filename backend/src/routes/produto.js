// Identificar/enriquecer um produto: o utilizador envia FOTOS dos rótulos + (op.)
// o EAN. Corre o VLM sobre as fotos E consulta o OFF pelo EAN, guarda e devolve
// AMBOS — em ambiente de teste, para ver o que se obtém de cada fonte.
import { Router } from 'express';
import multer from 'multer';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { getPool, parseJsonCol } from '../db.js';
import { config, paisCfg } from '../config.js';
import { POR_IDENTIFICAR_SQL } from '../criterios.js';
import { extrairProdutoFotos, arbitrarMarcaNome, consultarOFF, consultarCatalogo, analisarProduto, caracterizarProdutoNome, eanValido, lerEanDeFoto, analisarFotoProduto, buscarOffPorNome, garantirGenericoSku } from '../ingest/produto.js';
import { atualizarConteudoFicha } from '../normaliza/conteudo.js';
import { grupoDe, grupoDeNome, grupoDeTexto, marcaEhTipo, tokenCasa, singularizar, norm as normN, normAlfa, tipoConsumidor, cabecaNome } from '../normaliza/categoria.js';
import { facetasDe } from '../normaliza/facetas.js';
import { fundirFichaEan, formatarMedida } from '../normaliza/fichaEan.js';
import { acharPorNomeMarca, acharGemeo, nomeCondizGemeo } from '../normaliza/resolverPorNome.js';
import { nutricaoPlausivel } from '../normaliza/validadores.js';
import { alertasDoPerfil, avaliarParaPerfil, compararProdutosLLM } from '../ingest/perfil.js';
import { tituloProduto } from '../normaliza/titulo.js';
import { garantirFichaPT, pareceEstrangeiro } from '../ingest/traduz.js';
import { enriquecerDespensaLLM } from '../ingest/classificarDespensa.js';
import { analiseEan } from '../normaliza/ean.js';
import { resolverItensLista } from './lista.js';
import { matchImagemB64, vetorizarImagemB64, cosseno } from '../normaliza/matchImagem.js';
import { mestrePorEan } from '../normaliza/mestreEan.js';
import { gerarThumbCatalogo } from '../ingest/thumbCatalogo.js';
import { nutricaoContinenteLive } from '../ingest/nutricaoContinente.js';
import { tipoProduto, decidirTipo } from '../normaliza/tipoProduto.js';
import { familiaDe, familiaPorNome, familiasQueCasam, FAMILIAS } from '../normaliza/familia.js';
import { nutriScore } from '../normaliza/nutriscore.js';

// Fotos dos produtos vivem ao lado das das notas, num subdiretório 'produtos'.
const DIR_FOTOS = path.join(path.dirname(config.uploads.faturas), 'produtos');

// Trunca um valor ao tamanho da coluna. Guarda dura: o OFF/VLM podem devolver
// strings mais longas que a coluna (ex.: a hierarquia de categorias do OFF, ou
// uma validade verbosa do VLM) e um "Data too long" abortava o INSERT INTEIRO,
// perdendo a ficha toda. Truncar é sempre melhor que perder a identificação.
const lim = (s, n) => (s == null ? null : String(s).slice(0, n));

const parseJson = parseJsonCol; // alias da fonte única (db.js) — string OU objeto de coluna JSON

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
  const hashAtual = parseJson(atual?.fusao)?.fontes_hash; // fusao é coluna JSON (objeto) — parseJson trata
  if (!(atual?.nome && hashAtual === r.fusao.fontes_hash)) {
    const f = r.ficha;
    try {
      await pool.query(
        `INSERT INTO produto_ean (ean, item_id, sku_id, nome, marca, quantidade, categoria, ingredientes, alergenios, validade, nutricao, nutricao_confirmada, fonte, off_json, fusao, imagem_url)
           VALUES (?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
           ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), validade=COALESCE(VALUES(validade), validade),
           nutricao=VALUES(nutricao), nutricao_confirmada=VALUES(nutricao_confirmada), fonte=VALUES(fonte),
           off_json=COALESCE(VALUES(off_json), off_json), fusao=VALUES(fusao), imagem_url=COALESCE(VALUES(imagem_url), imagem_url)`,
        [ean, lim(f.nome, 200), lim(f.marca, 120), lim(f.quantidade, 60), lim(f.categoria, 255),
          f.ingredientes, f.alergenios, lim(f.validade, 60),
          f.nutricao ? JSON.stringify(f.nutricao) : null, f.nutricao_confirmada,
          (r.fusao.proveniencia.nome || 'fusao').slice(0, 10),
          r.off ? JSON.stringify(r.off) : null, JSON.stringify(r.fusao), lim(f.imagem_url, 500)],
      );
      await guardarNomes(ean, null, [{ nome: f.nome, origem: (r.fusao.proveniencia.nome || 'fusao').slice(0, 20) }]);
      await atualizarConteudoFicha(pool, ean);
    } catch (e) { console.error('[consultarOuGuardar] gravar fusão:', e.message); }
  }

  // tradução LLM fica FORA da fusão: quando o nome final não é PT — pela flag da
  // fusão OU por heurística (nome que ainda PARECE estrangeiro, ex.: "Eggs" que
  // escapou como candidato "PT"). Robustez 2026-06-15.
  let nome = r.ficha.nome;
  // CRESCER COM O USO: este EAN foi resolvido no servidor → entra na base_local PARTILHADA.
  // Corre SEMPRE (também em cache-hit, senão o corpus já-resolvido antes da migração nunca
  // povoava a base) e com o nome JÁ TRADUZIDO — a tradução grava em produto_ean.nome, não na
  // base_local; sem isto a base ficava com o nome estrangeiro para TODOS os telefones.
  // ptOk = o nome a gravar é PT-fiável (não parece estrangeiro). A app confia em origem 'uso'
  // para a LISTA (que guarda o nome verbatim) → só carimba 'uso' quando é mesmo PT; tradução
  // falhada/no-op deixa o nome estrangeiro → 'uso_es' (a lista cai no servidor, nunca polui).
  const crescerBaseLocal = (n) => upsertBaseLocal(pool, ean, { ...r.ficha, nome: n }, !pareceEstrangeiro(n))
    .catch((e) => console.error('[base_local upsert]', e.message));
  if (r.nomeEstrangeiro || pareceEstrangeiro(nome)) {
    if (traduzir) { nome = (await garantirFichaPT(pool, ean)) || nome; await crescerBaseLocal(nome); }
    else garantirFichaPT(pool, ean).then((pt) => crescerBaseLocal(pt || nome)).catch(() => crescerBaseLocal(nome));
  } else {
    await crescerBaseLocal(nome);
  }
  return { encontrado: true, fonte: r.fusao.proveniencia.nome || 'fusao', nome };
}

// CRESCER COM O USO (dono, 2026-06-17): todo o EAN resolvido no servidor (um miss, buscado fora
// do cliente) entra na base_local PARTILHADA com nutrição/ingredientes → vira HIT na próxima sync
// de TODOS os telefones. `ptOk`: nome PT-fiável → origem 'uso' (a lista confia); senão 'uso_es'
// (nome ainda estrangeiro p.ex. tradução falhou — fica fora do atalho da lista até traduzir).
// O `seq` (auto) fá-las descer no próximo poll. ON DUPLICATE não mexe no `seq` nem na `origem`
// (refresca dados sem re-sync inútil; preserva a classificação do bootstrap) e o COALESCE evita
// apagar nutrição/ingredientes que já lá estavam com uma resolução mais magra.
async function upsertBaseLocal(pool, ean, f, ptOk = true) {
  if (!ean || !f?.nome) return;
  // PROMOÇÃO (cresce-com-o-uso, 2026-06-18): um EAN que veio do bootstrap como pt_off/merc_es/uso_es
  // e que AGORA temos com nome PT-FIÁVEL passa a 'uso' (a lista/scan confiam → HIT local instantâneo).
  // Re-insere para ganhar um `seq` NOVO (AUTO_INCREMENT) e RE-SINCRONIZAR para os telefones. Antes o
  // ON DUPLICATE preservava a origem do bootstrap → 18k produtos pt_off/merc_es ficavam presos a cair
  // SEMPRE ao servidor (só 6 linhas 'uso' em 63k). pt_cat e uso ficam como estão (não há que promover).
  if (ptOk) {
    const [[ex]] = await pool.query('SELECT origem FROM base_local WHERE ean = ?', [ean]);
    if (ex && ex.origem !== 'pt_cat' && ex.origem !== 'uso') await pool.query('DELETE FROM base_local WHERE ean = ?', [ean]);
  }
  await pool.query(
    `INSERT INTO base_local (ean, nome, marca, quantidade, categoria, alergenios, nutricao, ingredientes, origem)
       VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
       alergenios=COALESCE(VALUES(alergenios), alergenios),
       nutricao=COALESCE(VALUES(nutricao), nutricao),
       ingredientes=COALESCE(VALUES(ingredientes), ingredientes)`,
    [ean, lim(f.nome, 255), lim(f.marca, 120), lim(formatarMedida(f.quantidade), 80), lim(f.categoria, 120),
      lim(f.alergenios, 255), f.nutricao ? JSON.stringify(f.nutricao) : null,
      f.ingredientes ? String(f.ingredientes).slice(0, 1200) : null,
      ptOk ? 'uso' : 'uso_es'],
  );
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

// Baixa uma imagem (URL) → base64. null se falhar (timeout curto: o OFF é lento).
async function imgUrlB64(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length ? b.toString('base64') : null;
  } catch { return null; }
}
// CONFIRMA POR IMAGEM (CLIP) que o gémeo sugerido é MESMO o produto: compara a FOTO do
// utilizador (produto_foto deste EAN/item) com a imagem do candidato. Devolve o score 0..1
// (ou null se não houver foto de referência / falhar). No scan-de-código NÃO há foto → null
// → a foto do candidato fica ESCONDIDA (não se mostra um palpite que pode nem ser parecido,
// como o dono apanhou: Páprica ⇏ Milho). Só corre quando há mesmo foto (custo só nesse caso).
async function confirmarGemeoPorImagem(pool, { ean, itemId, imagemUrl }) {
  if (!imagemUrl || (!ean && !itemId)) return null;
  const [[f]] = await pool.query(
    `SELECT ficheiro FROM produto_foto WHERE ${ean ? 'ean = ?' : 'item_id = ?'} AND ficheiro IS NOT NULL ORDER BY ordem, id LIMIT 1`,
    [ean || itemId]);
  if (!f?.ficheiro) return null;
  try {
    const refB64 = (await readFile(f.ficheiro)).toString('base64');
    const [vRef, candB64] = await Promise.all([vetorizarImagemB64(refB64), imgUrlB64(imagemUrl)]);
    if (!vRef || !candB64) return null;
    const vCand = await vetorizarImagemB64(candB64);
    return vCand ? cosseno(vRef, vCand) : null;
  } catch { return null; }
}

// Consolida TUDO o que sabemos de um produto (por item da nota OU por EAN):
// funde as várias linhas de produto_ean (vlm/off) e lista as fotos guardadas.
export async function consolidarProduto({ itemId, eanQ, skuId: skuParam, pais }) {
  // PAÍS do utilizador (camada preço+locale): decide moeda + que fontes de catálogo dão
  // o preço/nome locais. PT → €/lojas PT; BR → R$/lojas VTEX. A IDENTIDADE (EAN) é igual.
  const cfgPais = paisCfg(pais);
  const fontesPais = cfgPais.fontesPreco;
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
  let ean = itemEan || eanQ || null;
  // Ficha aberta SÓ com sku_id (lista/compras/histórico, sem ean): resolve um EAN do SKU para
  // ler a FICHA POR EAN. Sem isto, ficava só com o genérico → SEM nutrição/ingredientes/imagem
  // (bug do Oikos: scan mostrava tudo, mas abrir da lista não). EAN do talão > ficha por sku.
  if (!ean && skuId) {
    const [[e]] = await getPool().query(
      `SELECT ean FROM item WHERE sku_id = ? AND ean IS NOT NULL AND ean <> '' ORDER BY id DESC LIMIT 1`, [skuId]);
    ean = e?.ean
      || (await getPool().query(`SELECT ean FROM produto_ean WHERE sku_id = ? AND ean IS NOT NULL AND ean <> '' ORDER BY id LIMIT 1`, [skuId]))[0][0]?.ean
      || null;
  }

  // CONSOLIDAR ANTES DE LER (resolvedor único): o fusor recolhe TODAS as fontes (catálogo, off_full,
  // …) e grava a ficha em produto_ean. Assim o read lê SEMPRE a ficha — nada de fontes cruas no read.
  // Idempotente (só grava se as fontes mudaram); CRIA a ficha se ainda não existia (ex.: um EAN que só
  // estava no off_full passa a ter ficha completa). É aqui que se garante "a informação está na tabela".
  if (ean) await consultarOuGuardar(ean).catch((e) => console.error('[info] consolidar:', e.message));

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
  let base = rows.find((r) => r.nome || r.marca)
    ? (() => { const r = rows.find((x) => x.nome || x.marca); return { nome: r.nome, marca: r.marca, quantidade: r.quantidade, categoria: r.categoria, fonte: r.fonte }; })()
    : null;
  // NOME: quando há EAN, a ficha do EAN (produto_ean.nome) é a fonte CANÓNICA e vence o nome do
  // SKU/talão (dono 2026-06-25: o EAN identifica o produto; o nome do recibo é a pior fonte).
  if (ean && base?.nome) nome = base.nome;
  // nome PT-first (scan/busca, sem item da nota). Ordem:
  //  1) nome_canonico do SKU — a NOSSA canonicalização PT (ex.: o iogurte grego
  //     Hacendado do Mercadona vira "Iogurte Grego Natural", como no talão);
  //  2) catálogo, preferindo uma fonte PT por EAN (cross-loja: mesmo EAN no
  //     Continente/Auchan dá o nome PT).
  // Sem nada disto → fica null e a ficha usa o que houver (pode ser ES).
  if (!nome && skuId) {
    const [[s]] = await getPool().query('SELECT nome_canonico FROM sku_normalizado WHERE id = ?', [skuId]);
    nome = s?.nome_canonico || null;
  }
  if (!nome && ean) {
    const [[sk]] = await getPool().query(
      `SELECT s.nome_canonico FROM item i JOIN sku_normalizado s ON s.id = i.sku_id
        WHERE i.ean = ? AND s.nome_canonico IS NOT NULL AND s.nome_canonico <> '' ORDER BY i.id DESC LIMIT 1`, [ean]);
    nome = sk?.nome_canonico || null;
  }
  // ficha persistida (fusão + tradução PT) ANTES do nome cru do catálogo: um
  // lidl-fr/mercadona-ES já traduzido ("Ketchup de Tomate") vence o "Ketchup Allégé"
  // que o catálogo ainda tem. base = produto_ean (resolvido por fundirFichaEan).
  if (!nome && base?.nome) nome = base.nome;
  if (!nome && ean) {
    const [[cat]] = await getPool().query(
      `SELECT COALESCE(nome_pt, nome) AS nome FROM catalogo_produto
        WHERE ean = ? AND COALESCE(nome_pt, nome) IS NOT NULL
        ORDER BY (fonte IN (?)) DESC, (nome_pt IS NOT NULL) DESC, id ASC
        LIMIT 1`, [ean, fontesPais]);
    nome = cat?.nome || null;
  }
  // NUTRIÇÃO oficial de loja (prioritária sobre OFF). Se o scan não tem nutrição
  // em lado nenhum (nem OFF nem VLM) e o EAN é vendido no CONTINENTE, busca a tabela
  // AO VIVO (separador AJAX) e guarda — senão fica o OFF/VLM/genérico. Lazy + cacheado.
  if (ean) {
    const temNut = (o) => o?.nutricao_100g && Object.values(o.nutricao_100g).some((v) => v != null);
    const [[c]] = await getPool().query(
      "SELECT nutricao FROM catalogo_produto WHERE ean = ? AND nutricao IS NOT NULL AND JSON_LENGTH(nutricao) > 0 ORDER BY (fonte = 'continente') DESC, (fonte = 'auchan') DESC, id LIMIT 1", [ean]);
    let nutCat = parseJson(c?.nutricao); // coluna JSON (objeto) ou string — fonte única trata
    if (nutCat && !Object.values(nutCat).some((v) => v != null)) nutCat = null; // objeto todo-null não conta
    if (!nutCat && !temNut(off) && !temNut(vlm)) {
      try { const cont = await nutricaoContinenteLive(getPool(), ean); if (cont?.nutricao) nutCat = cont.nutricao; } catch { /* live falhou */ }
    }
    if (nutCat) { if (base) base.nutricao_100g = nutCat; else base = { nutricao_100g: nutCat }; }
  }
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
  // IMAGEM da ficha (produto_ean.imagem_url) — fonte centralizada; o catálogo só para categoria/tipo
  // (e como fallback da imagem se a ficha ainda não a tiver).
  const fichaImg = rows.find((r) => r.imagem_url && String(r.imagem_url).trim())?.imagem_url || null;
  let imagemCatalogo = fichaImg, catalogoCategoria = null, catalogoTipo = null;
  if (ean) {
    const [[img]] = await getPool().query(
      `SELECT imagem_url, categoria, product_type FROM catalogo_produto
        WHERE (ean = ? OR ean_inferido = ?) AND ((imagem_url IS NOT NULL AND imagem_url <> '') OR (categoria IS NOT NULL AND categoria <> '') OR product_type IS NOT NULL)
        ORDER BY (product_type IS NOT NULL) DESC, (imagem_url IS NOT NULL AND imagem_url <> '') DESC LIMIT 1`, [ean, ean]);
    imagemCatalogo = fichaImg || img?.imagem_url || null;
    catalogoCategoria = img?.categoria || null;
    catalogoTipo = img?.product_type || null;
  }
  // ALIMENTO vs NÃO-ALIMENTO: usa o product_type GUARDADO (backfill 058); se não houver
  // (produto fora do catálogo), classifica ao vivo (mesma lógica). Controla o layout da ficha.
  const temNutP = (o) => o?.nutricao_100g && Object.values(o.nutricao_100g).some((v) => v != null);
  // EAN do GÉMEO adotado por-nome (mesmo produto sob outro EAN): registado no fusao
  // da ficha quando o utilizador confirmou a sugestão. Liga nutrição+imagem do gémeo.
  const refNome = (() => { for (const r of rows) { const f = parseJson(r.fusao); if (f?.nome_ref_ean) return String(f.nome_ref_ean); } return null; })();
  // Nutrição CONFIRMADA guardada na ficha (ex.: adotada do gémeo): se nenhuma fonte ao
  // vivo trouxe nutrição, usa-a — assim a adoção por-nome reflete-se na ficha.
  if (!temNutP(off) && !temNutP(vlm) && !temNutP(base) && !temGenericoNut) {
    const lr = rows.find((r) => r.nutricao && r.nutricao_confirmada === 1);
    const fn = lr ? parseJson(lr.nutricao) : null;
    if (fn && Object.values(fn).some((v) => v != null)) base = { ...(base || {}), nutricao_100g: fn };
  }
  // Imagem do gémeo adotado (produto_ean não guarda imagem → resolve-se pelo ref). O gémeo
  // pode ser do off_full OU do nosso catálogo (BR) → tenta os dois, senão a foto não aparece.
  if (!imagemCatalogo && refNome) {
    try {
      const [[ir]] = await getPool().query('SELECT imagem_url FROM off_full WHERE ean = ? LIMIT 1', [refNome]);
      imagemCatalogo = ir?.imagem_url || imagemCatalogo;
      if (!imagemCatalogo) { const [[ic]] = await getPool().query("SELECT imagem_url FROM catalogo_produto WHERE ean = ? AND imagem_url IS NOT NULL ORDER BY id LIMIT 1", [refNome]); imagemCatalogo = ic?.imagem_url || imagemCatalogo; }
    } catch { /* off_full/catalogo pode faltar localmente */ }
  }
  // Voto da MARCA (fatia departamento do marca_perfil): só quando vai pesar (sem
  // catálogo-tipo) e há marca. Especialista de departamento vota forte (Hacendado→food).
  let marcaShareFood = null;
  const marcaTipo = base?.marca || vlm?.marca || off?.marca || null;
  if (!catalogoTipo && marcaTipo) {
    try {
      const [[mp]] = await getPool().query(
        'SELECT share_food FROM marca_perfil WHERE marca_norm = ? AND (n_food + n_nonfood) >= 8', [normAlfa(marcaTipo)]);
      if (mp && mp.share_food != null) marcaShareFood = mp.share_food;
    } catch { /* marca_perfil pode não existir ainda */ }
  }
  // FUSOR food/não-food (departamento): catálogo (058) primeiro; senão funde os sinais
  // (nutrição → VLM-tipo do pacote → marca → nome/categoria) com proveniência.
  const tipoFus = decidirTipo({
    nome,
    temNutricao: temNutP(off) || temNutP(vlm) || temNutP(base) || temNutP(generico),
    foodGroups: off?.grupos_alimento,
    categoria: [catalogoCategoria, off?.categoria, off?.categorias_tags, base?.categoria, vlm?.categoria].filter(Boolean).join(' '),
    tipoTexto: [vlm?.tipo_no_pacote, vlm?.tipo_inferido?.tipo].filter(Boolean).join(' '),
    marcaShareFood,
  });
  const tipo = catalogoTipo || tipoFus.tipo;
  const tipoVia = catalogoTipo ? 'catalogo' : tipoFus.via;
  // FAMÍLIA (2.º nível do fusor): nome + categoria-loja/OFF + VLM-tipo. Mesmos sinais do
  // departamento. Resolve homónimos (Pérolas→massa). Alimenta as alternativas e a ficha.
  const famR = familiaDe({
    nome,
    marca: marcaTipo,
    categoria: [catalogoCategoria, off?.categoria, off?.categorias_tags, base?.categoria, vlm?.categoria].filter(Boolean).join(' '),
    tipoTexto: [vlm?.tipo_no_pacote, vlm?.tipo_inferido?.tipo].filter(Boolean).join(' '),
  });
  const familiaSlug = famR.familia;
  const familiaLabel = familiaSlug ? (FAMILIAS[familiaSlug]?.label || null) : null;
  // CATEGORIA exibida na NOSSA taxonomia (PT) — família (mais específica) > grupo (corredor). Evita
  // mostrar a string crua/multilíngue do OFF (ex.: Mercadona em espanhol: "Lácteos,Nata,en:UHT…").
  // Determinística; o grupoDeNome/família já reconhecem vocabulário ES/EN, por isso o mapa cobre tudo.
  const GRUPO_LABEL = { frutas: 'Frutas e Vegetais', carne: 'Carne', peixe: 'Peixe', lacticinios: 'Laticínios', padaria: 'Padaria', bebidas: 'Bebidas', doces: 'Doces e Snacks', congelados: 'Congelados', higiene: 'Higiene e Limpeza', mercearia: 'Mercearia' };
  const catTexto = [catalogoCategoria, off?.categoria, base?.categoria, vlm?.categoria, nome].filter(Boolean).join(' ');
  const grupoTax = grupoDeTexto(catTexto) || grupoDeNome(nome || '');
  // CONSERVA não é fresco (dono 2026-06-25): a classificação já manda enlatados p/ mercearia; aqui só
  // se afina o RÓTULO exibido ("Conservas de peixe/carne") detetando o tipo do alimento no texto.
  const tn = normN(catTexto);
  const ehConserva = /(^|[^a-z])(conservas?|enlatad\w*|em\s+lata|en\s+lata|\d+\s*latas?)([^a-z]|$)/.test(tn);
  let categoriaPt = familiaLabel;
  if (!categoriaPt && ehConserva) {
    categoriaPt = /(atum|atun|tuna|sardinh|cavala|caballa|anchov|anchoa|pescado|peixe|fish|mexilh|berberech|polvo|lula|calamar|bacalhau)/.test(tn) ? 'Conservas de peixe'
      : /(carne|frango|porco|vaca|bovin|salsich|presunto|chouric|pate|jamon|embutid)/.test(tn) ? 'Conservas de carne' : 'Conservas';
  }
  // UTILIDADES DE COZINHA (não-alimentar): alumínio/película/papel vegetal/moldes/herméticos/sacos de
  // congelação não são "Higiene e Limpeza" (o token "papel" mandava o alumínio p/ higiene). Balde próprio.
  if (!categoriaPt && tipo === 'non_food' && /(aluminio|pelicula|\bfilm\b|papel\s+(vegetal|manteiga|de\s+forno|para\s+horno)|\bmoldes?\b|hermetic|(sacos?|bolsas?)\s+(de\s+|para\s+)?(congel|conserv|frio|basura|lixo))/.test(tn)) categoriaPt = 'Cozinha e utilidades';
  if (!categoriaPt) categoriaPt = GRUPO_LABEL[grupoTax] || null;
  // NUNCA mostrar a categoria CRUA estrangeira (ES/multilíngue do OFF/Mercadona, ex.: "Herméticos
  // y moldes"). Sem mapa na taxonomia → balde PT por tipo: não-alimentar = "Casa e utilidades".
  if (!categoriaPt && tipo === 'non_food') categoriaPt = 'Casa e utilidades';
  // SUGESTÃO por-nome (texto acha, o utilizador confirma): ficha "magra" (sem nutrição
  // NEM imagem em fonte nenhuma) e ainda não ligada a um gémeo → procura no off_full o
  // MESMO produto sob OUTRO EAN (match por nome+marca, marca=gate forte). NÃO adota:
  // devolve o candidato para a ficha sugerir e só gravar após confirmação (ver
  // POST /adotar-nome). Só dispara para fichas magras → não pesa no caso normal.
  let sugestaoNome = null;
  const temNutFinal = temNutP(off) || temNutP(vlm) || temNutP(base) || temGenericoNut;
  const marcaBusca = base?.marca || vlm?.marca || off?.marca || null;
  const nomeBusca = nome || base?.nome || vlm?.nome || off?.nome || null;
  // NÃO sugere gémeo a NÃO-ALIMENTO: não há nutrição a adotar e a marca casa qualquer coisa
  // (caso real: "Filtros de Café" não-alimentar → cápsulas "Café Dosettes", mesma marca Barissimo).
  if (ean && !refNome && !temNutFinal && !imagemCatalogo && nomeBusca && marcaBusca && tipo !== 'non_food') {
    try {
      const termosBusca = Array.isArray(vlm?.termos_busca) ? vlm.termos_busca : null;
      const cands = await acharPorNomeMarca(getPool(), { nome: nomeBusca, marca: marcaBusca, tamanho: base?.quantidade || vlm?.quantidade || off?.quantidade || null, termos: termosBusca });
      // GATE de precisão, DOIS sinais: (1) a FAMÍLIA tem de bater — só rejeita quando ambas são
      // conhecidas e DIFEREM (caso real: Páprica/especiarias ≠ "Maíz Dulce Milho Doce"/conservas,
      // mesma marca Hacendado + a palavra genérica "doce"); (2) o NOME/termos do VLM condizem
      // (nomeCondizGemeo), não só a marca. Sem ambos é um gémeo errado (mesma marca, outro produto).
      const famOk = (x) => { const f = familiaPorNome(x.nome, x.marca); return !familiaSlug || !f || f === familiaSlug; };
      const c = cands.find((x) => (x.tem_nutricao || x.imagem_url) && x.ean !== ean && famOk(x)
        && nomeCondizGemeo({ nome: nomeBusca, marca: marcaBusca, termos: termosBusca, candNome: x.nome }));
      if (c) {
        // CONFIRMAÇÃO POR IMAGEM: a foto do candidato só se mostra se a CLIP a casar com a foto
        // do utilizador (quando há). Sem foto de referência → não confirmada → foto escondida.
        const score = await confirmarGemeoPorImagem(getPool(), { ean, itemId, imagemUrl: c.imagem_url });
        sugestaoNome = { ean_ref: c.ean, nome: c.nome, marca: c.marca, tamanho: c.tamanho, nutricao_100g: c.nutricao_100g, imagem_url: c.imagem_url, tamanho_bate: c.tamanho_bate, confirmada_imagem: score != null && score >= 0.72, score_imagem: score != null ? Math.round(score * 1000) / 1000 : null };
      }
    } catch { /* off_full/FULLTEXT pode faltar localmente */ }
  }
  // PREÇO-referência de catálogo no PAÍS do utilizador (camada preço+locale): o mais
  // barato entre as fontes do país, na moeda do país. Dá um preço R$/€ à ficha do scan
  // (referência, nunca facto — o facto vem do talão). Filtra clearance/não-produto.
  let precoCatalogo = null;
  if (ean) {
    const [[p]] = await getPool().query(
      `SELECT preco, COALESCE(moeda, ?) AS moeda, preco_por_base, unidade_base, fonte
         FROM catalogo_produto
        WHERE ean = ? AND preco IS NOT NULL AND fonte IN (?)
        ORDER BY preco ASC LIMIT 1`, [cfgPais.moeda, ean, fontesPais]);
    // a fonte ∈ fontesPais → o preço está na moeda do país POR DEFINIÇÃO (não depender
    // da coluna `moeda`, cujo default é EUR e pode estar errado em fontes raspadas).
    if (p) precoCatalogo = { preco: Number(p.preco), moeda: cfgPais.moeda, preco_por_base: p.preco_por_base != null ? Number(p.preco_por_base) : null, unidade_base: p.unidade_base || null, loja: p.fonte };
  }
  // ANÁLISE DO EAN (passo 0 do funil): país GS1 + empresa minada (ean_empresa). Sinal
  // determinístico disponível ANTES de qualquer fonte. A `marca` da empresa só se asserta
  // com coerência alta (share≥0.8); senão fica `marca_provavel` (peso = coerência).
  let analiseEanInfo = null;
  if (ean && /^\d{13}$/.test(ean)) {
    const [[emp]] = await getPool().query('SELECT marca, pais AS pais_emp, share, n_produtos FROM ean_empresa WHERE prefixo = ?', [ean.slice(0, 8)]);
    analiseEanInfo = analiseEan(ean, {
      empresa: emp ? { prefixo: ean.slice(0, 8), marca: emp.share >= 0.8 ? emp.marca : null, marca_provavel: emp.marca, pais: emp.pais_emp, coerencia: Number(emp.share), n: emp.n_produtos } : null,
    });
  }
  // VOTO da análise do EAN: empresa → MARCA quando nenhuma fonte deu marca (caso Nesquik).
  // Só a marca ASSERTIDA (coerência≥0.8); a identidade vem das fontes, isto é só o fallback.
  // A marca do CATÁLOGO (por EAN, preferindo fontes do país) é fonte real → vem antes do voto.
  let marcaCatalogo = null;
  if (ean && /^\d{13}$/.test(ean)) {
    const [[cm]] = await getPool().query(
      `SELECT marca FROM catalogo_produto WHERE ean = ? AND marca IS NOT NULL AND marca <> ''
        ORDER BY (fonte IN (?)) DESC, id ASC LIMIT 1`, [ean, fontesPais]);
    marcaCatalogo = cm?.marca || null;
  }
  const marcaFonte = base?.marca || vlm?.marca || off?.marca || marcaCatalogo || null;
  let marcaResolvida = marcaFonte || analiseEanInfo?.empresa?.marca || null;
  let marcaVia = marcaFonte ? 'fonte' : (analiseEanInfo?.empresa?.marca ? 'ean_empresa' : null);
  // GUARD: uma "marca" que é na verdade um TIPO/genérico (Leite, Iogurte…) é dado errado da fonte
  // → rejeita (não a mostra nem a usa como gate). Genéricos estrangeiros (ex.: 'Sauerkraut') não
  // entram aqui (vocabulário PT/ES) — ficam p/ a blocklist por rácio do corpus.
  if (marcaResolvida && marcaEhTipo(marcaResolvida)) { marcaResolvida = null; marcaVia = null; }
  // ingredientes/alergénios FUNDIDOS da ficha (produto_ean) — a fonte canónica decidida pelo fusor
  // (Nutripédia > lojas > OFF). O read passa a CONSUMI-los em vez de tirar do off/vlm cru.
  const ingredientesFicha = (rows.find((r) => r.ingredientes && String(r.ingredientes).trim())?.ingredientes) || null;
  const alergeniosFicha = (rows.find((r) => r.alergenios && String(r.alergenios).trim())?.alergenios) || null;
  // NUTRIÇÃO + TAMANHO fundidos da ficha — a fonte que o app DEVE mostrar. Só quando a ficha não tem
  // (scan fresco ainda sem ficha, ou só estimativa genérica) é que se cai para as fontes cruas/genérico.
  const temV = (o) => o && Object.values(o).some((v) => v != null);
  const nutFicha = parseJson(rows.find((r) => r.nutricao)?.nutricao);
  const nutricaoDisplay = temV(nutFicha) ? nutFicha : (off?.nutricao_100g || vlm?.nutricao_100g || base?.nutricao_100g || generico?.nutricao_100g || null);
  const tamanhoFicha = (rows.find((r) => r.quantidade && String(r.quantidade).trim())?.quantidade) || off?.quantidade || vlm?.quantidade || base?.quantidade || null;
  return { ean, vlm, off, base, generico, skuId, nome, fonte, fotos, imagem_catalogo: imagemCatalogo,
    ingredientes: ingredientesFicha, alergenios: alergeniosFicha, nutricao_100g: nutricaoDisplay, tamanho: formatarMedida(tamanhoFicha), nutricao_provisoria: nutricaoProvisoria, tipo, tipo_via: tipoVia, familia: familiaSlug, familia_label: familiaLabel, familia_via: famR.via, catalogo_categoria: categoriaPt || catalogoCategoria, sugestao_nome: sugestaoNome, nome_ref: refNome, preco_catalogo: precoCatalogo, moeda: cfgPais.moeda, pais: (pais || config.paisDefault).toUpperCase(), analise_ean: analiseEanInfo, marca: marcaResolvida, marca_via: marcaVia, existe: rows.length > 0 || temGenericoNut,
    // ficha MAGRA = nem nutrição nem imagem: não temos como mostrar nada útil. Mesmo que haja um
    // nome/marca (talvez só DECODIFICADO do EAN), o scan deve pedir FOTOS (VLM) em vez de abrir
    // uma ficha inútil. (sugestão de gémeo já passa pelo gate de precisão `nomeCondizGemeo`.)
    ficha_magra: !temNutFinal && !imagemCatalogo,
    nutriscore_calc: nutriScore(nutricaoDisplay) };
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

    // ANÁLISE DO EAN como PISTA ao VLM: marca provável pelo prefixo (ean_empresa, coerência
    // alta). Ajuda a desempatar a leitura e deixa-nos detetar conflito EAN↔pacote.
    let pistaMarca = null;
    if (eanManual && /^\d{13}$/.test(eanManual)) {
      const [[emp]] = await getPool().query('SELECT marca, share FROM ean_empresa WHERE prefixo = ?', [eanManual.slice(0, 8)]);
      if (emp && Number(emp.share) >= 0.8) pistaMarca = emp.marca;
    }
    // VLM sobre as fotos (com a pista do EAN, se houver)
    let vlm = null, custo = 0;
    if (fotos.length) {
      try { const r = await extrairProdutoFotos(fotos, { contexto: { marcaProvavel: pistaMarca } }); vlm = r.dados; custo = r.custo; }
      catch (e) { vlm = { erro: e.message }; }
    }
    // CONFLITO EAN↔pacote: o VLM leu uma marca que NÃO bate com a provável pelo código
    // (nem uma contém a outra) → sinaliza p/ revisão (pode ser EAN mal lido ou prefixo reusado).
    const nm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const marcaConflito = !!(pistaMarca && vlm?.marca && nm(vlm.marca) && nm(pistaMarca) && !nm(vlm.marca).includes(nm(pistaMarca)) && !nm(pistaMarca).includes(nm(vlm.marca)));
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
        // ÁRBITRO multimodal: OFF e VLM discordam no nome/marca → um VLM olha as FOTOS e decide
        // (resolve trocas/genéricos como o 'Sauerkraut'). Só no conflito; alimenta a fusão.
        let arbitro;
        try {
          const conflito = off && vlm && fotos.length
            && ((off.marca && vlm.marca && nm(off.marca) !== nm(vlm.marca)) || (off.nome && vlm.nome && nm(off.nome) !== nm(vlm.nome)));
          if (conflito) { const a = await arbitrarMarcaNome({ off, vlm, fotos }); if (a?.nome || a?.marca) { arbitro = { nome: a.nome, marca: a.marca }; custo += a.custo || 0; } }
        } catch (e) { console.error('[produto/identificar] arbitro:', e.message); }
        const rf = await fundirFichaEan(getPool(), ean, { atual: atualPE, extra: { off: off || undefined, vlm: vlm || undefined, arbitro } });
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

    // GÉMEO sob OUTRO EAN: se a ficha ficou MAGRA (sem nutrição), cruza a FOTO (CLIP) com o
    // nome+marca do VLM para achar o MESMO produto sob outro código. Convergência dos dois
    // sinais → candidato p/ o humano confirmar (não adota automático). Buraco #1 fechado.
    let gemeo = null;
    try {
      if (fotos.length && !nutricao) {
        gemeo = await acharGemeo(getPool(), { fotoB64: fotos[0].base64, nome: vlm?.nome || nome, marca: vlm?.marca || pistaMarca, tamanho: vlm?.quantidade, termos: Array.isArray(vlm?.termos_busca) ? vlm.termos_busca : null, tipoTexto: [vlm?.tipo_no_pacote, vlm?.tipo_inferido?.tipo].filter(Boolean).join(' '), eanProprio: ean });
      }
    } catch (e) { console.error('[produto/identificar] gemeo:', e.message); }

    res.json({ ean, vlm, off, generico, fonte: fonte || (generico?.nutricao_100g ? 'generico' : null), custo, n_fotos: fotos.length, fotos_guardadas: nGuardadas, ean_rejeitado: eanRejeitado, marca_provavel_ean: pistaMarca, marca_conflito: marcaConflito, gemeo });
  } catch (e) {
    console.error('[produto/identificar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a identificar o produto' });
  }
});

// ADOTAR por-nome: o utilizador confirmou, na ficha, que o produto escaneado é o MESMO
// que um gémeo achado no off_full sob outro EAN (match por nome+marca). Copia a NUTRIÇÃO
// do gémeo para a ficha do EAN escaneado (confirmada) e regista a proveniência
// (nome_ref_ean no fusao) — reversível (limpar o ref desfaz) e auditável. A imagem NÃO
// se copia: o /info resolve-a do off_full por esse EAN. NUNCA é facto do EAN exato.
// Lógica pura (testável sem HTTP): copia a nutrição do gémeo `eanRef` (off_full) para a
// ficha de `ean` e regista a proveniência. Devolve {nutricao_100g, imagem_url} ou null se
// o gémeo não existir. A imagem NÃO se copia (produto_ean não a guarda); fica o ref.
export async function adotarNomeRef(pool, ean, eanRef) {
  // O gémeo pode estar no off_full OU só no NOSSO catálogo (ex.: BR) — a busca varre os dois
  // (migração 064), por isso a adoção também tem de ler os dois. Senão um gémeo de catálogo
  // dá `null` aqui e a adoção falha em SILÊNCIO (o botão "Usar" não fazia nada).
  let nut = null; let imagemRef = null;
  const [[ref]] = await pool.query(
    `SELECT energia_kcal, gordura, gordura_sat, hidratos, acucares, proteinas, sal, fibra, imagem_url
       FROM off_full WHERE ean = ? LIMIT 1`, [eanRef]);
  if (ref) {
    nut = { energia_kcal: ref.energia_kcal, gordura: ref.gordura, gordura_saturada: ref.gordura_sat, hidratos: ref.hidratos, acucares: ref.acucares, proteina: ref.proteinas, sal: ref.sal, fibra: ref.fibra };
    imagemRef = ref.imagem_url || null;
  } else {
    const [[cat]] = await pool.query(
      "SELECT nutricao, imagem_url FROM catalogo_produto WHERE ean = ? AND nutricao IS NOT NULL AND JSON_LENGTH(nutricao) > 0 ORDER BY (fonte = 'continente') DESC, (fonte = 'auchan') DESC, id LIMIT 1", [eanRef]);
    if (cat) { nut = parseJson(cat.nutricao); imagemRef = cat.imagem_url || null; }
  }
  if (!nut) return null;
  const temNut = Object.values(nut).some((v) => v != null);
  const [[pe]] = await pool.query('SELECT id, fusao FROM produto_ean WHERE ean = ? ORDER BY id LIMIT 1', [ean]);
  const fus = pe ? (parseJson(pe.fusao) || {}) : {};
  fus.nome_ref_ean = eanRef;
  fus.proveniencia = { ...(fus.proveniencia || {}), nutricao: temNut ? 'por-nome' : (fus.proveniencia?.nutricao || null), imagem: imagemRef ? 'por-nome' : (fus.proveniencia?.imagem || null) };
  if (pe) {
    await pool.query(
      'UPDATE produto_ean SET nutricao = COALESCE(?, nutricao), nutricao_confirmada = ?, fusao = ? WHERE ean = ?',
      [temNut ? JSON.stringify(nut) : null, temNut ? 1 : 0, JSON.stringify(fus), ean]);
  } else {
    await pool.query(
      'INSERT INTO produto_ean (ean, nutricao, nutricao_confirmada, fonte, fusao) VALUES (?,?,?,?,?)',
      [ean, temNut ? JSON.stringify(nut) : null, temNut ? 1 : 0, 'por-nome', JSON.stringify(fus)]);
  }
  return { nutricao_100g: temNut ? nut : null, imagem_url: imagemRef };
}

produtoRouter.post('/adotar-nome', requireAuth, async (req, res) => {
  try {
    const ean = String(req.body?.ean || '').replace(/\D/g, '');
    const eanRef = String(req.body?.ean_ref || '').replace(/\D/g, '');
    if (!ean || !eanRef) return res.status(400).json({ erro: 'Faltam ean e ean_ref.' });
    const r = await adotarNomeRef(getPool(), ean, eanRef);
    if (!r) return res.status(404).json({ erro: 'Produto de referência não encontrado.' });
    res.json({ ok: true, ean, ean_ref: eanRef, ...r });
  } catch (e) {
    console.error('[produto/adotar-nome] erro:', e.message);
    res.status(500).json({ erro: 'Falha a adotar o produto.' });
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
produtoRouter.post('/consultados', requireAuth, async (req, res) => {
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
produtoRouter.get('/consultados', requireAuth, async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 10, 1), 100);
    const [produtos] = await getPool().query(
      `SELECT h.ean, h.sku_id,
              COALESCE((SELECT pe1.nome FROM produto_ean pe1 WHERE pe1.ean = h.ean AND pe1.nome IS NOT NULL AND pe1.nome <> '' ORDER BY pe1.id LIMIT 1), h.nome) AS nome,
              h.marca, h.n_consultas, h.ultima_em, h.primeira_em
       FROM historico_produto h WHERE h.utilizador = ? ORDER BY h.ultima_em DESC LIMIT ${limite}`,
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
    res.json(await consolidarProduto({ itemId, eanQ, skuId, pais: req.user?.pais }));
  } catch (e) {
    console.error('[produto/info] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar info do produto' });
  }
});

// SAÚDE (FSA): pontuação determinística por 100 g — MENOR = mais saudável. Mesmos limiares do
// semáforo `nivel()` do frontend: penaliza açúcar + gordura saturada + sal (níveis 0..3 cada);
// premia fibra + proteína (1..2). Serve para ORDENAR as alternativas da mais saudável e NÃO mostrar
// as que são PIORES que o produto pesquisado (regra do dono: alternativas têm de ser melhores).
const _FSA = {
  acucares:  [[0.5, 0], [5, 1], [22.5, 2], [Infinity, 3]],
  saturados: [[0.1, 0], [1.5, 1], [5, 2], [Infinity, 3]],
  sal:       [[0.1, 0], [0.3, 1], [1.5, 2], [Infinity, 3]],
  fibra:     [[3, 1], [6, 2], [Infinity, 2]],
  proteina:  [[12, 1], [20, 2], [Infinity, 2]],
};
function _nivelFsa(tipo, v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  for (const [lim, lvl] of _FSA[tipo]) if (Number(v) <= lim) return lvl;
  return 3;
}
function pontuacaoSaude(n) {
  if (!n || (n.acucares == null && n.gordura_saturada == null && n.sal == null && n.fibra == null && n.proteina == null)) return null;
  const mau = (_nivelFsa('acucares', n.acucares) ?? 0) + (_nivelFsa('saturados', n.gordura_saturada) ?? 0) + (_nivelFsa('sal', n.sal) ?? 0);
  const bom = (_nivelFsa('fibra', n.fibra) ?? 0) + (_nivelFsa('proteina', n.proteina) ?? 0);
  return mau - bom; // -4 (ótimo) .. +9 (mau)
}

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
    const info = await consolidarProduto({ itemId, eanQ, skuId, pais: req.user?.pais });
    const nutAtual = info.nutricao_100g || info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null;
    // LOCALIZAÇÃO: só sugerir produtos vendidos no PAÍS do utilizador (fontes do catálogo desse país) —
    // não faz sentido propor um produto só-BR a um user PT, e vice-versa. SAÚDE: score FSA do pesquisado.
    const fontesPais = new Set(paisCfg(req.user?.pais).fontesPreco);
    const scoreAtual = pontuacaoSaude(nutAtual);
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
    // (gate de honestidade movido para DEPOIS de tipoAtual — precisa do tipo para decidir)
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
    // FAMÍLIA (fusor): massa compara com massa, não com ketchup/azeite (o grupo mercearia
    // é um saco de secos). A família já vem resolvida do consolidarProduto (nome +
    // categoria-loja/OFF + VLM-tipo → resolve homónimos). Fora da mercearia (sem família),
    // cai no tipoConsumidor.
    const marcaAtual = info.base?.marca || info.off?.marca || info.vlm?.marca || null;
    const famAtual = info.familia;
    const tipoAtual = tipoConsumidor(grupo, nomeFacetas, marcaAtual);
    // CHAVE DE COMPARABILIDADE (regra GERAL — não curar família a família): nos grupos-SACO de
    // processados, duas coisas só são alternativas se partilham a CHAVE = família curada (fusor) →
    // senão tipo-fino (massa/cereais/conservas/tomate; 'pao' FICA FORA, lumpa tortilha↔pão ralado) →
    // senão o SUBSTANTIVO-CABEÇA do nome (tortilha≠pão≠azeite saem sozinhos). Aplica-se quando a busca
    // foi por GRUPO (sem mestre.categoria, que já é fino). Frescos (fruta/carne/peixe) cruzam pelo
    // grupo de propósito (banana→maçã) e NÃO entram aqui. Sem chave → vazio honesto (> lixo).
    const ehSaco = new Set(['bebidas', 'lacticinios', 'doces', 'mercearia', 'padaria']).has(grupo);
    const TIPOS_FINOS = ['massa', 'cereais', 'conservas', 'tomate'];
    const tipoFinoDe = (nome, marca) => { const t = tipoConsumidor(grupo, nome, marca); return TIPOS_FINOS.includes(t) ? t : null; };
    const chaveDe = (nome, marca = null) => familiaPorNome(nome, marca) || (ehSaco ? (tipoFinoDe(nome, marca) || cabecaNome(nome)) : null);
    const chaveAtual = famAtual || (ehSaco ? (tipoFinoDe(nomeFacetas, marcaAtual) || cabecaNome(nomeFacetas)) : null);
    if (ehSaco && !mestreCat) {
      if (!chaveAtual) return res.json({ grupo, nivel, produto: { nome: info.nome, nutricao: nutAtual }, alternativas: [] });
      cands = cands.filter((c) => chaveDe(c.nome) === chaveAtual);
    } else if (famAtual) {
      cands = cands.filter((c) => familiaPorNome(c.nome) === famAtual);
    } else if (['massa', 'pao', 'cereais', 'conservas', 'tomate'].includes(tipoAtual)) {
      cands = cands.filter((c) => tipoConsumidor(grupo, c.nome, null) === tipoAtual);
    }
    // parse + dedup por nome canónico; pontua a SAÚDE (FSA) de cada candidato.
    const vistos = new Set();
    const alternativas = cands.map((c) => {
      const nut = parseJson(c.nutricao);
      return { sku_id: c.id, nome: c.nome, corte: c.corte || null, variedade: c.variedade || null, teor: c.teor || null,
        eur_base: c.eur_base != null ? Number(c.eur_base) : null, unidade_base: c.unidade_base || null, nutricao: nut, _s: pontuacaoSaude(nut) };
    }).filter((a) => {
      const k = a.nome.toLowerCase();
      if (vistos.has(k) || !a.nutricao) return false; vistos.add(k); return true;
    });

    // NÃO-PIOR que o pesquisado (regra do dono: alternativa tem de ser melhor/igual em saúde). Se
    // poucas opções não-piores em casa, vamos ao CATÁLOGO — mas só do PAÍS do user e só não-piores.
    const naoPior = (a) => scoreAtual == null || a._s == null || a._s <= scoreAtual;
    if (alternativas.filter(naoPior).length < 2) {
      const [catCands] = await getPool().query(
        `SELECT nome, marca, fonte, categoria, categoria_path, preco_por_base, unidade_base, formato, nutricao
           FROM catalogo_produto
          WHERE nome IS NOT NULL AND nome <> '' AND nutricao IS NOT NULL
          LIMIT 20000`);
      const vistosCat = new Set(alternativas.map((a) => a.nome.toLowerCase()));
      const doCatalogo = [];
      for (const c of catCands) {
        if (fontesPais.size && !fontesPais.has(c.fonte)) continue; // LOCALIZAÇÃO: só fontes do país do user
        if (!mesmaDieta(c.nome)) continue;
        // o NOME tem de casar a família-alvo, E a CATEGORIA-PATH do catálogo não pode indicar CLARAMENTE
        // outra família (veto): "Petit Nesquik" path 'iogurtes/…', "Rolinhos …Cacau" path '…bolos/…'.
        if (ehSaco && !mestreCat) {
          if (chaveDe(c.nome, c.marca) !== chaveAtual) continue; // mesma chave (família/tipo-fino/cabeça)
          if (famAtual) { const fc = familiasQueCasam(`${c.categoria_path || ''} ${c.categoria || ''}`.replace(/[/_-]+/g, ' ')); if (fc.length && !fc.includes(famAtual)) continue; }
        } else if (famAtual) {
          if (familiaPorNome(c.nome, c.marca) !== famAtual) continue;
          const fc = familiasQueCasam(`${c.categoria_path || ''} ${c.categoria || ''}`.replace(/[/_-]+/g, ' '));
          if (fc.length && !fc.includes(famAtual)) continue;
        } else if (['massa', 'pao', 'cereais', 'conservas', 'tomate'].includes(tipoAtual)) { if (tipoConsumidor(grupo, c.nome, c.marca) !== tipoAtual) continue; }
        else if (grupoDeNome(c.nome) !== grupo) continue;
        const k = c.nome.toLowerCase();
        if (vistosCat.has(k) || k === String(nomeFacetas).toLowerCase()) continue;
        const nut = parseJson(c.nutricao);
        const cand = { sku_id: null, nome: c.nome, marca: c.marca || null, origem: 'catalogo', fonte: c.fonte,
          eur_base: c.preco_por_base != null ? Number(c.preco_por_base) : null,
          unidade_base: c.unidade_base || null, formato: c.formato || null, nutricao: nut, _s: pontuacaoSaude(nut) };
        if (!naoPior(cand)) continue; // catálogo só traz não-piores
        vistosCat.add(k); doCatalogo.push(cand);
        if (doCatalogo.length >= 30) break; // pool p/ o ranking escolher os 6 mais saudáveis
      }
      alternativas.push(...doCatalogo);
    }

    // RANKING por SAÚDE: a mais saudável primeiro; fora as PIORES que o pesquisado; top 6.
    // `mais_saudavel` = estritamente melhor (para o frontend destacar). Desempate: tem preço.
    const ord = alternativas
      .filter(naoPior)
      .sort((a, b) => (a._s ?? 99) - (b._s ?? 99) || (b.eur_base != null) - (a.eur_base != null))
      .slice(0, 6)
      .map(({ _s, ...a }) => ({ ...a, mais_saudavel: scoreAtual != null && _s != null && _s < scoreAtual, nutriscore: nutriScore(a.nutricao) }));
    res.json({ grupo, nivel, categoria: mestreCat, produto: { nome: info.nome, nutricao: nutAtual, score_saude: scoreAtual, nutriscore: nutriScore(nutAtual) }, alternativas: ord });
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

// AUTOCOMPLETE da busca de produto (lista + nutrição), sobre produto_busca (índice
// FULLTEXT, ~dezenas de milhares PT). Ranking que mata os "esquisitos" do prefixo:
//  palavra-exata (+100) > começa-com (+40) > prefixo-no-meio (~0); GENÉRICO no topo
//  (+1000); na lista, ALIMENTO primeiro (+30); popularidade da casa desempata.
//  Último token = prefixo (em digitação), anteriores = palavra exata.
produtoRouter.get('/autocomplete', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').toLowerCase().trim();
    const modo = req.query.modo === 'nutricao' ? 'nutricao' : 'lista';
    const limpa = (t) => t.replace(/[^a-z0-9áàâãéêíóôõúüç]/gi, '');
    const toks = q.split(/\s+/).map(limpa).filter((t) => t.length >= 1).slice(0, 6);
    if (!toks.length || q.length < 2) return res.json({ sugestoes: [] });
    const bool = toks.map((t, i) => `+${t}${i === toks.length - 1 ? '*' : ''}`).join(' ');
    const last = toks[toks.length - 1];
    const wb = `\\b${last}\\b`; // palavra inteira (REGEXP, word boundary)
    const food = modo === 'lista' ? "+ (product_type='food')*30" : '';
    // Só GENÉRICOS + ESPECÍFICOS que a casa já comprou/listou (popularidade>0). Sem isto, o
    // autocomplete despejava ~milhares de específicos do catálogo que a casa nunca teve
    // (decisão do dono 2026-06-17). `popularidade` dos específicos = histórico da casa
    // (lista + compras + EANs identificados; ver construir_produto_busca.mjs).
    const [rows] = await getPool().query(
      `SELECT generico, nome, marca, tamanho, ean, tem_nutricao,
              ( (nome REGEXP ?)*100 + (LOWER(nome) LIKE CONCAT(?, '%'))*40
                + generico*1000 ${food} + LEAST(popularidade, 50) ) AS score
         FROM produto_busca
        WHERE MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE)
          AND (generico = 1 OR popularidade > 0)
        ORDER BY score DESC, MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE) DESC
        LIMIT 8`,
      [wb, last, bool, bool]);
    res.json({ sugestoes: rows.map((r) => ({
      generico: !!r.generico, nome: r.nome, marca: r.marca || null,
      tamanho: r.tamanho || null, ean: r.ean || null, tem_nutricao: !!r.tem_nutricao,
    })) });
  } catch (e) {
    console.error('[produto/autocomplete] erro:', e.message);
    res.json({ sugestoes: [] });
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

// BUSCA por nome no CATÁLOGO (~76k) — devolve VÁRIOS produtos COMPLETOS (ao
// contrário do /por-nome, que resolve um só). CRITÉRIO (dono, provisório): só
// produtos com nome + marca + tamanho(formato) + foto + EAN + NUTRIÇÃO (no próprio
// catálogo OU no OFF por EAN). Cada token aparece em nome/nome_pt/marca; dedup por
// EAN (prefere com nutrição no catálogo e nome curto). Cada item abre a ficha por EAN.
const NUT_OK = (a) => `${a}.nutricao IS NOT NULL AND ${a}.nutricao <> '' AND ${a}.nutricao <> '{}'`;
produtoRouter.get('/buscar', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const toks = normN(q).split(/\s+/).filter((t) => t.length >= 2);
    if (!toks.length) return res.json({ produtos: [], total: 0 });
    const cond = toks.map(() => '(LOWER(CONCAT_WS(" ", c.nome, c.nome_pt, c.marca)) LIKE ?)').join(' AND ');
    const [rows] = await getPool().query(
      `SELECT c.ean, COALESCE(c.nome_pt, c.nome) AS nome, c.marca, c.formato AS tamanho,
              c.imagem_url AS imagem, (${NUT_OK('c')}) AS nut_cat
         FROM catalogo_produto c
        WHERE c.ean IS NOT NULL AND c.ean <> ''
          AND c.marca IS NOT NULL AND c.marca <> ''
          AND c.formato IS NOT NULL AND c.formato <> ''
          AND c.imagem_url IS NOT NULL AND c.imagem_url <> ''
          AND ${cond}
          AND ( (${NUT_OK('c')})
                OR EXISTS (SELECT 1 FROM off_produto o WHERE o.ean = c.ean AND (${NUT_OK('o')})) )
        ORDER BY (${NUT_OK('c')}) DESC, CHAR_LENGTH(c.nome) ASC
        LIMIT 300`, toks.map((t) => `%${t}%`));
    const vistos = new Set(); const produtos = [];
    for (const r of rows) {
      if (vistos.has(r.ean)) continue; vistos.add(r.ean);
      produtos.push({ ean: r.ean, nome: r.nome, marca: r.marca, tamanho: r.tamanho, imagem: r.imagem });
      if (produtos.length >= 40) break;
    }
    res.json({ produtos, total: produtos.length });
  } catch (e) {
    console.error('[produto/buscar] erro:', e.message);
    res.status(500).json({ erro: 'Falha na busca por nome' });
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

// BASE LOCAL — FICHAS pré-construídas (base_local, migração 067): identificação+nutrição de
// ~63k EANs (catálogo PT + Mercadona ES + PT do off_full) para o scan responder instantâneo/
// offline. Incremental por cursor de `ean` (a PK ordena), em chunks. `versao` muda quando se
// reconstrói a base → o telefone faz resync do zero.
const BASE_LOCAL_VER = '2'; // cursor por `seq` (apanha crescimento vivo); v1 era por `ean`
produtoRouter.get('/base-local-fichas', requireAuth, async (req, res) => {
  try {
    const desde = Number(req.query.desde_seq) || 0;
    const limite = Math.min(Math.max(Number(req.query.limite) || 3000, 100), 5000);
    const [fichas] = await getPool().query(
      `SELECT seq, ean, nome, marca, quantidade, categoria, product_type, alergenios,
              nutriscore, nova, CAST(nutricao AS CHAR) AS nutricao, ingredientes, origem
         FROM base_local
        WHERE seq > ?
        ORDER BY seq
        LIMIT ?`,
      [desde, limite],
    );
    const ultimo = fichas.length ? fichas[fichas.length - 1].seq : desde;
    res.json({ versao: BASE_LOCAL_VER, fichas, cursor: ultimo, fim: fichas.length < limite });
  } catch (e) {
    console.error('[produto/base-local-fichas] erro:', e.message);
    res.status(500).json({ erro: 'Falha a sincronizar as fichas locais' });
  }
});

// Telemetria da BASE LOCAL: o telefone diz se RESOLVEU um EAN localmente (hit) ou teve de ir
// ao servidor (miss). Mede a taxa de acerto e, pelos EANs dos misses, o que falta na base
// (p.ex. produtos LIDL/ALDI europeus, deixados de fora de propósito). Fire-and-forget.
produtoRouter.post('/local-hit', requireAuth, async (req, res) => {
  try {
    const ean = String(req.body?.ean || '').replace(/\D/g, '').slice(0, 20) || null;
    const hit = req.body?.hit ? 1 : 0;
    const origem = String(req.body?.origem || '').slice(0, 20) || null;
    await getPool().query('INSERT INTO base_local_evento (ean, hit, origem) VALUES (?,?,?)', [ean, hit, origem]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// "Despensa" = inventário do que a casa TEM, alimentado por SCAN (migração 049).
// Já NÃO deriva das compras (decisão do dono, 2026-06-12: o que se comprou não diz
// o que ainda está em casa). Partilhada; ordenada pelo scan mais recente.
produtoRouter.get('/despensa', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const mercado = req.query.mercado || null;
    const [rows] = await pool.query(
      `SELECT ean, nome, marca, validade, atualizado_em AS data FROM despensa ORDER BY atualizado_em DESC, id DESC`);
    const limparVal = (v) => { const s = String(v ?? '').trim(); return s && !/^null$/i.test(s) ? s : null; };
    // NOME PT-FIRST: o nome canónico (produto_ean, já traduzido pelo backfill) vence o nome guardado
    // no scan, que podia ser espanhol/estrangeiro. Os que ainda parecem estrangeiros traduzem-se em
    // FUNDO (garantirFichaPT persiste em produto_ean) e a despensa é corrigida → próximo load fica PT.
    const eans = [...new Set(rows.map((r) => r.ean))];
    const cls = new Map(), ptByEan = new Map();
    if (eans.length) {
      const ph = eans.map(() => '?').join(',');
      const [c] = await pool.query(`SELECT ean, seccao, nome_pt FROM ean_classificacao WHERE ean IN (${ph})`, eans);
      for (const r of c) cls.set(String(r.ean), r);
      const [pe] = await pool.query(`SELECT ean, MIN(NULLIF(nome, '')) AS nome FROM produto_ean WHERE ean IN (${ph}) GROUP BY ean`, eans);
      for (const r of pe) if (r.nome) ptByEan.set(String(r.ean), r.nome);
    }
    // NOME PT-FIRST: classificação canónica (LLM) > nome do produto_ean (traduzido) > nome guardado no scan.
    const nomeFinal = (r) => { const c = cls.get(String(r.ean)); if (c?.nome_pt && !pareceEstrangeiro(c.nome_pt)) return c.nome_pt; const cano = ptByEan.get(String(r.ean)); return (cano && !pareceEstrangeiro(cano)) ? cano : r.nome; };
    // MESMO enriquecimento da lista (marca, tamanho, preço) → formato rico. `seccao` = secção canónica (LLM).
    const itens = rows.map((r) => ({ id: r.ean, nome: nomeFinal(r), ean: r.ean, seccao: cls.get(String(r.ean))?.seccao || null, estado: 'ativo', quantidade: 1, marca_scan: r.marca, validade: limparVal(r.validade), data: r.data }));
    await resolverItensLista(pool, itens, mercado, { leve: true }); // inventário: salta a estimativa de preço pelo irmão (~1,7s)
    for (const it of itens) { if (!it.marca) it.marca = it.marca_scan || null; delete it.marca_scan; }
    res.json({ produtos: itens });
    // FUNDO (não bloqueia): LLM classifica+traduz os SEM classificação canónica (ou ainda estrangeiros) →
    // persiste em ean_classificacao + produto_ean.nome → MELHORA A BASE; próximo load fica correto.
    const faltam = rows.filter((r) => !cls.has(r.ean) || pareceEstrangeiro(nomeFinal(r)));
    if (faltam.length) enriquecerDespensaLLM(pool, faltam.map((r) => ({ ean: r.ean, nome: nomeFinal(r) }))).catch(() => {});
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
      ingredientes: info.ingredientes || info.vlm?.ingredientes || info.off?.ingredientes || null,
      nutricao_100g: info.nutricao_100g || info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null,
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

    const [[p]] = await getPool().query('SELECT id, nome, resumo, saude_estado FROM perfil_membro WHERE ativo = 1 LIMIT 1');
    if (!p) return res.json({ perfil: null });
    const resumo = parseJsonCol(p.resumo) || {};
    // a demografia (sexo/idade/peso/altura) vive em saude_estado → junta-se ao resumo p/ o prompt.
    const demografia = parseJsonCol(p.saude_estado)?.demografia;
    if (demografia) resumo.demografia = demografia;

    const info = await consolidarProduto({ itemId, eanQ, skuId });
    const produto = {
      nome: info.off?.nome || info.vlm?.nome || info.generico?.alimento || info.nome || null,
      categoria: info.off?.categoria || info.vlm?.categoria || info.generico?.categoria || null,
      ingredientes: info.ingredientes || info.vlm?.ingredientes || info.off?.ingredientes || null,
      alergenios: info.off?.alergenios || info.vlm?.alergenios || null,
      nutricao_100g: info.nutricao_100g || info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null,
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

    const [[p]] = await getPool().query('SELECT id, nome, resumo, saude_estado FROM perfil_membro WHERE ativo = 1 LIMIT 1');
    const resumo = p ? (parseJsonCol(p.resumo) || {}) : null;
    const demografiaCmp = p ? parseJsonCol(p.saude_estado)?.demografia : null;
    if (resumo && demografiaCmp) resumo.demografia = demografiaCmp;

    // NOME PT-FIRST antes de comparar: garante a linha produto_ean (fusão das fontes) e TRADUZ o nome
    // estrangeiro (o LLM JULGA — apanha o que a heurística `pareceEstrangeiro` deixa passar, p.ex. nomes
    // Lidl/off multilíngue; PT fica igual). Persiste em produto_ean.nome → consolidarProduto lê o PT.
    // Em paralelo p/ não somar as latências de tradução dos vários produtos.
    await Promise.all(eans.map((ean) =>
      consultarOuGuardar(ean).catch(() => {}).then(() => garantirFichaPT(getPool(), ean).catch(() => {})),
    ));

    const produtos = [];
    for (const ean of eans) {
      const info = await consolidarProduto({ eanQ: ean });
      const prod = {
        ean,
        // nome RESOLVIDO PT-first (nome_canonico/catálogo PT/ficha traduzida) ANTES do cru
        // (off/vlm em ES/maiúsculas) + título normalizado — vale p/ os cards E p/ o texto do LLM.
        nome: tituloProduto(info.nome || info.base?.nome || info.off?.nome || info.vlm?.nome || info.generico?.alimento || ean),
        marca: info.off?.marca || info.vlm?.marca || info.base?.marca || null,
        quantidade: info.off?.quantidade || info.vlm?.quantidade || info.base?.quantidade || null,
        categoria: info.off?.categoria || info.vlm?.categoria || info.generico?.categoria || null,
        ingredientes: info.ingredientes || info.vlm?.ingredientes || info.off?.ingredientes || null,
        alergenios: info.off?.alergenios || info.vlm?.alergenios || null,
        nutricao_100g: info.nutricao_100g || info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g || null,
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

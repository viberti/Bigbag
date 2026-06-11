// Resolve um item de talão (nome abreviado) → produto real (EAN + nutrição),
// juntando candidatos do CATÁLOGO local (Auchan/Continente, com EAN por nome PT)
// e do OPEN FOOD FACTS (por nome, traz marcas-próprias + nutrição). Pontua por
// tokens/marca/formato e, opcionalmente, confirma com um JUIZ LLM (distingue
// variantes: caixa vs barras, culinário vs leite — onde o token-overlap falha).
import { chatCompletion } from '../openrouter.js';
import { extrairFormato } from './formato.js';
import { nomesPorEan } from './mestreEan.js';
import { expandirAbreviaturas } from './abreviaturas.js';

const STOP = new Set(['de','da','do','e','com','sem','para','por','kg','kgs','g','gr','grs','ml','cl','lt','l','un','und','unid','sabor','tipo','pack','x','the','of']);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t.length >= 3 && !STOP.has(t));

// SABOR/TEOR/DIETA: discriminadores DUROS — vocabulário ÚNICO e multilingue em
// facetas.js (A6): morango=fresa=strawberry; magro≠meio-gordo; "natural" é valor.
// Semântica mantida: talão com facetas → o candidato tem de ter EXATAMENTE as
// mesmas; talão sem facetas → não bloqueia. Re-exportado para os consumidores.
import { saborConflito, compararFacetas } from './facetas.js';
export { saborConflito };

// RARIDADE (IDF): cada palavra pesa pela sua raridade no catálogo. "mel" aparece em
// centenas de produtos → pesa pouco; "rosmaninho" em poucos → pesa muito. Carrega
// uma vez (cache no processo); a partir daí o match dá importância às palavras que
// DISTINGUEM, não às da categoria que todos partilham.
let _idf = null;
export async function carregarIdf(pool) {
  if (_idf) return _idf;
  const [rows] = await pool.query("SELECT nome FROM catalogo_produto WHERE nome IS NOT NULL AND nome <> ''");
  const df = new Map();
  for (const r of rows) for (const t of new Set(toks(r.nome))) df.set(t, (df.get(t) || 0) + 1);
  const N = rows.length || 1;
  const w = new Map();
  for (const [t, d] of df) w.set(t, Math.log((N + 1) / (d + 1)));
  _idf = { w, max: Math.log(N + 1) }; // palavra nunca vista → tão rara quanto possível
  return _idf;
}
const peso = (idf, t) => (idf ? (idf.w.get(t) ?? idf.max) : 1);

// Formatos compatíveis? (ex.: 330g vs 6x25g → incompatível). null = desconhecido (não penaliza).
function formatoCompativel(a, b) {
  const fa = extrairFormato(a), fb = extrairFormato(b);
  if (!fa || !fb || fa.formato_valor == null || fb.formato_valor == null) return null;
  if (fa.unidade_base !== fb.unidade_base) return false;
  const r = fa.formato_valor / fb.formato_valor;
  return r > 0.8 && r < 1.25; // ±25%
}

// PORTA de marca: a marca do candidato (catálogo) tem de aparecer no item do talão.
// Exige TODOS os tokens da marca presentes (evita falsos como "Pingo Doce" a casar
// só por "doce"). Sem marca no candidato, ou marca ausente no item → não confirma.
// É o que separa o Caso 2 (marca nacional, mesmo GTIN) do Caso 1 (marca-própria).
function marcaBate(item, marcaCand) {
  const bm = toks(marcaCand);
  if (!bm.length) return false;
  const hay = new Set(toks(`${item.descricao} ${item.marca || ''}`));
  return bm.every((t) => hay.has(t));
}

// PORTA do produto: tirando os tokens da MARCA dos dois lados, o que define a comida
// (o substantivo: requeijão, mel, presunto) tem de bater. Sem isto, a marca/região
// sozinha deixa passar "requeijão Serra Estrela" → "ÁGUA Serra Estrela". Devolve a
// fração de tokens não-marca do talão que aparecem no candidato (0..1).
// peso de POSIÇÃO: a 1ª/2ª palavra da descrição é o substantivo do produto e pesa
// mais — se a inicial não bate, dificilmente é o mesmo produto ("MEL ..." vs "Caderno").
const pesoPos = (i) => (i === 0 ? 2.4 : i === 1 ? 1.6 : 1);

export function produtoOverlap(item, nomeCand, marcaCand, idf) {
  const brand = new Set(toks(marcaCand));
  const ordem = toks(item.descricao); // em ORDEM (para o peso de posição)
  const itemNB = [...new Set(ordem)].filter((t) => !brand.has(t));
  if (!itemNB.length) return 0;
  const candNB = new Set(toks(nomeCand).filter((t) => !brand.has(t)));
  // fração do PESO (raridade × posição) dos tokens do talão que o candidato cobre.
  // Partilhar só "mel" (comum, mas inicial) vs falhar a inicial → fica abaixo de 0,5.
  let num = 0, den = 0;
  for (const t of itemNB) { const w = peso(idf, t) * pesoPos(ordem.indexOf(t)); den += w; if (candNB.has(t)) num += w; }
  return den ? num / den : 0;
}

// PORTA de preço (FILTRO DE DISPARATE, não desempate fino): preço é cross-loja/data e
// o €/base varia com a embalagem, por isso NÃO se usa para escolher entre vizinhos a
// cêntimos (isso promovia a variante errada). Serve só para matar o GROSSEIRAMENTE
// fora — >5× num sentido = quase de certeza outro produto (ex.: requeijão €1,51 vs
// queijo €16,69). Margem larga p/ tolerar diferença de loja/promo/tamanho e unidades.
function precoDisparate(itemPpb, candPpb) {
  if (!itemPpb || !candPpb) return false; // sem preço → não filtra
  const r = itemPpb / candPpb;
  return r > 5 || r < 0.2;
}

// ── Match MESMA-LOJA (ex.: Continente → catálogo Continente) ───────────────
// Combina comida (rarity, do candidatosCatalogo) + PREÇO de embalagem (forte: na
// mesma loja o preço pago ≈ preço do catálogo) + MARCA-PRÓPRIA (CNT/CONTINENTE →
// catálogo de marca "Continente%"; marca nacional no talão → bónus; marca diferente
// num item own-brand → penaliza). Validado a ~57% de precisão exata (teto 70%).
const FAM_CONT = new Set(['continente', 'selecao', 'seleccao', 'equilibrio', 'bio', 'cozinha', 'kitchen']);
const proxPreco = (a, b) => (a && b ? Math.abs(Math.log(a / b)) : 99);
function bonusPreco(itPreco, candPreco) {
  const p = proxPreco(itPreco, candPreco);
  // SÓ bónus (preço longe pode ser só outro tamanho de embalagem — não penaliza).
  return p === 99 ? 0 : p < 0.1 ? 0.5 : p < 0.2 ? 0.3 : p < 0.4 ? 0.1 : 0;
}

// item: { descricao (p/ comida — usa canónico), descricaoRaw (p/ marca — nome do talão),
//         preco (€ pago da embalagem), preco_por_base }. Devolve a melhor proposta
//         combinada + confianca [0..1] + alternativas, ou null.
export async function proporMesmaLoja(pool, item, fonte) {
  const cands = await candidatosCatalogo(pool, item, { fonte, portaMarca: false, limite: 30 });
  const descRaw = item.descricaoRaw || item.descricao;
  // porta de sabor pelo nome DO TALÃO (o canónico pode ter perdido o sabor).
  const bons = cands.filter((c) => c.score >= 0.4 && !saborConflito(descRaw, c.nome));
  if (!bons.length) return null;
  const hay = new Set(toks(descRaw));
  // MARCAS nacionais CONFIRMADAS pelo talão: a marca de um candidato cujos tokens
  // aparecem TODOS no nome do talão (ex.: "carlsberg"). Se o talão confirma uma
  // marca, candidatos de OUTRA marca nacional são produtos diferentes → penaliza.
  const marcasConf = new Set();
  for (const c of bons) {
    const bm = toks(c.marca).filter((t) => !FAM_CONT.has(t));
    if (bm.length && bm.every((t) => hay.has(t))) bm.forEach((t) => marcasConf.add(t));
  }
  const marcaCtx = (marcaCand) => {
    const bm = toks(marcaCand).filter((t) => !FAM_CONT.has(t));
    const ownCand = /continente/.test(norm(marcaCand || ''));
    const ownReceipt = /\bcnt\b|continente/i.test(descRaw);
    if (bm.length && bm.every((t) => hay.has(t))) return 0.5;                         // marca do candidato BATE no talão
    if (marcasConf.size && bm.length && !bm.some((t) => marcasConf.has(t))) return -0.6; // talão confirma marca X → candidato marca Y ≠ → penaliza forte
    if (ownReceipt && ownCand) return 0.35;                                           // item own-brand → candidato Continente
    if (ownReceipt && bm.length) return -0.45;                                        // item own-brand → candidato outra marca
    return 0;
  };
  // DETALHE: tokens DISTINTIVOS do talão que o canónico deixou cair (ex.: "seia",
  // "lagos", "lata") — comparação do nome COMPLETO sem stop words. Premeia o candidato
  // que cobre estes detalhes (escolhe "Seia Lagos" vs "Seia Tavares"; "em Lata" vs
  // garrafa). Ignora ruído do talão (cnt/emb/un) e tokens com dígitos (tamanho → preço).
  const NOISE = new Set(['cnt', 'emb', 'und', 'uni', 'unid', 'embal', 'cont']);
  const canonToks = new Set(toks(item.descricao));
  const extras = [...new Set(toks(descRaw))].filter((t) => !canonToks.has(t) && !NOISE.has(t) && !/\d/.test(t));
  const detalhe = (c) => {
    if (!extras.length) return 0;
    const cn = new Set(toks(c.nome));
    let hit = 0; for (const t of extras) if (cn.has(t)) hit++;
    return 0.3 * (hit / extras.length); // até +0.3 quando cobre os detalhes do talão
  };
  // RANKING: comida + MARCA (manda sobre o preço) + DETALHE (nome completo) + preço.
  const total = (c) => c.score + marcaCtx(c.marca) + detalhe(c) + bonusPreco(item.preco, c.preco);
  const ranked = bons.map((c) => ({ c, t: total(c), base: c.score + marcaCtx(c.marca) + detalhe(c) })).sort((a, b) => b.t - a.t);
  const top = ranked[0];
  const dp = proxPreco(item.preco, top.c.preco);
  const precoBate = dp < 0.12;             // preço (≈tamanho) confirma
  const precoLonge = dp !== 99 && dp > 0.4; // preço claramente diferente → tamanho NÃO confirma
  // CONFIANÇA: o nome+marca identificam o PRODUTO (base), mas só é ALTA se o TAMANHO
  // confirmar (preço bate). Sem confirmação, trava em média/baixa — evita casar uma
  // embalagem diferente que parece a mesma (ex.: 6×1L vs 1L avulso).
  let conf = top.base;
  if (precoBate) conf = Math.min(1, conf + 0.3);
  else conf = Math.min(conf, precoLonge ? 0.5 : 0.7);
  return {
    ...top.c,
    score: top.t,
    confianca: Math.max(0, Math.min(1, conf)),
    preco_bate: precoBate,
    alternativas: ranked.slice(1, 4).map((r) => r.c),
  };
}

function pontuar(item, cand, idf) {
  const qi = toks(`${item.descricao} ${item.marca || ''}`);
  const tc = new Set(toks(`${cand.nome} ${cand.marca || ''}`));
  if (!qi.length) return 0;
  // sobreposição ponderada por raridade × POSIÇÃO (palavras iniciais = o substantivo).
  let num = 0, den = 0;
  for (let i = 0; i < qi.length; i++) { const w = peso(idf, qi[i]) * pesoPos(i); den += w; if (tc.has(qi[i])) num += w; }
  let score = den ? num / den : 0;
  // bónus de marca
  if (item.marca && tc.has(norm(item.marca).split(' ')[0])) score += 0.15;
  // formato
  const fc = formatoCompativel(item.descricao, cand.nome);
  if (fc === false) score -= 0.35; // formato incompatível → forte penalização
  if (fc === true) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

// ── Candidatos do catálogo local (só com EAN) ──────────────────────────────
// opts: { limite, fonte: filtra a uma fonte do catálogo (ex.: 'continente'),
//         portaMarca: exige a marca do candidato no talão (default true — desligar
//         no match MESMA-LOJA, onde a marca é implícita e o "CNT" não bate "Continente") }
export async function candidatosCatalogo(pool, item, opts = {}) {
  const { limite = 12, fonte: fonteFiltro = null, portaMarca = true } = opts;
  const idf = await carregarIdf(pool);
  const q = [...new Set(toks(`${item.descricao} ${item.marca || ''}`))];
  if (!q.length) return [];
  // 1) Gera EANs candidatos: procura pelos tokens MAIS RAROS (não os mais longos) —
  // é "rosmaninho"/"frosties" que traz os candidatos certos, não "mel"/"cereais".
  const chave = q.sort((a, b) => peso(idf, b) - peso(idf, a)).slice(0, 4);
  const meta = new Map(); // ean → { marca, categoria_path, fontes:Set, ppb }
  for (const tok of chave) {
    const [rows] = await pool.query(
      `SELECT ean, marca, categoria_path, fonte, preco_por_base, preco, formato FROM catalogo_produto
         WHERE ean IS NOT NULL AND ean <> '' AND nome LIKE ?${fonteFiltro ? ' AND fonte = ?' : ''} LIMIT 40`,
      fonteFiltro ? [`%${tok}%`, fonteFiltro] : [`%${tok}%`]);
    for (const r of rows) {
      if (!meta.has(r.ean)) meta.set(r.ean, { marca: r.marca, categoria_path: r.categoria_path, fontes: new Set(), ppb: r.preco_por_base, preco: r.preco, formato: r.formato });
      const m = meta.get(r.ean);
      m.fontes.add(r.fonte);
      if (!m.marca && r.marca) m.marca = r.marca;
      if (r.preco_por_base != null && (m.ppb == null || r.preco_por_base < m.ppb)) m.ppb = r.preco_por_base;
      if (r.preco != null && (m.preco == null || r.preco < m.preco)) m.preco = r.preco;
      if (!m.formato && r.formato) m.formato = r.formato;
    }
  }
  if (!meta.size) return [];
  // 2) Mestre por EAN: busca TODAS as variantes de nome (Auchan+Continente+ident) de
  // cada EAN e pontua contra a MELHOR variante → a tese (match contra todas as fontes).
  const nomes = await nomesPorEan(pool, [...meta.keys()]);
  return [...meta.entries()].map(([ean, m]) => {
    // PORTA: a marca do candidato tem de aparecer no talão — senão não arriscamos
    // (é o que evita o "BIO MILHO DOCE" → Bonduelle). Desligável no match mesma-loja.
    if (portaMarca && !marcaBate(item, m.marca)) return null;
    const variantes = [...(nomes.get(ean) || [])];
    let melhor = variantes[0] || '', best = 0;
    for (const n of variantes) { const s = pontuar(item, { nome: n, marca: m.marca }, idf); if (s > best) { best = s; melhor = n; } }
    // PORTA do produto: o substantivo distintivo (sem a marca) tem de bater em ≥50%
    // do PESO — mata "requeijão→água", "mel rosmaninho→mel laranjeira", variantes erradas.
    if (produtoOverlap(item, melhor, m.marca, idf) < 0.5) return null;
    // PORTA de sabor: morango ≠ baunilha → produtos diferentes, não casar.
    if (saborConflito(item.descricao, melhor)) return null;
    // PORTA de preço: mata disparates (>5× fora) — ex.: "REQUEIJÃO €1,51/kg" → "QUEIJO
    // Serra Estrela €16,69/kg". Não desempata fino (isso erra a variante).
    if (precoDisparate(item.preco_por_base, m.ppb)) return null;
    // EANs com prefixo "2" são códigos INTERNOS de loja (peso variável) — não são
    // GTINs reais nem têm nutrição no OFF; despriorizar para o GTIN real ganhar.
    const score = /^2/.test(ean) ? best * 0.6 : best;
    const fonte = [...m.fontes].join('+');
    return { ean, nome: melhor, nomes: variantes, marca: m.marca, categoria_path: m.categoria_path, preco_por_base: m.ppb, preco: m.preco, formato: m.formato, fonte, origem: fonte, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limite);
}

// ── A2: BUSCA no catálogo para CANONICALIZAÇÃO (Analise_Fontes §3.4) ────────
// Transforma o nome abreviado do talão no nome REAL do catálogo, como um motor
// de busca: tokens expandidos (dicionário de abreviaturas) + PREFIXO
// (BOL→Bolachas, LIG→Ligeiro) + raridade (IDF) + gate de sabor + formato como
// desempate + prior da MESMA cadeia. Inclui as fontes SEM EAN (Pingo Doce/Lidl)
// — o objetivo é o nome/marca/categoria, não o EAN (esse é o candidatosCatalogo,
// calibrado à parte para a aba EANs). "com/sem" NÃO são ruído aqui (negação que
// define o produto: com côdea ≠ sem côdea).
const STOPB = new Set([...STOP].filter((t) => t !== 'com' && t !== 'sem'));
// Tokens de FORMATO (200g, 1kg, 33cl, 4x115g, 6x1l) ficam FORA do scoring: o
// formato é desempate à parte (formatoBusca), não evidência de nome — senão
// "…200g" do catálogo Auchan ganhava a um nome certo sem tamanho embutido (PD).
const TOKEN_FORMATO = /^\d+([.,]\d+)?(g|gr|grs|kg|kgs|ml|cl|l|lt|un|dz)?$|^\d+x\d+\w*$/i;
const toksB = (s) => norm(s).split(' ').filter((t) => t.length >= 3 && !STOPB.has(t) && !TOKEN_FORMATO.test(t));

let _catMem = null;
async function catalogoEmMemoria(pool) {
  if (_catMem) return _catMem;
  // nome_pt: tradução PT do nome (catálogos em ES, ex.: Mercadona) — tokeniza-se
  // o PT quando existe, para o talão português casar na PRÓPRIA cadeia em vez de
  // perder para um catálogo PT. O `nome` exibido também passa a ser o PT.
  const [rows] = await pool.query("SELECT nome, nome_pt, marca, categoria_path, ean, fonte, formato, formato_valor, unidade_base, preco_por_base FROM catalogo_produto WHERE nome IS NOT NULL AND nome <> ''");
  _catMem = rows.map((r) => ({ ...r, nome: r.nome_pt || r.nome, t: toksB(`${r.nome_pt || r.nome} ${r.marca || ''}`) }));
  return _catMem;
}

const FONTE_POR_CADEIA = { 'continente': 'continente', 'pingo doce': 'pingodoce', 'auchan': 'auchan', 'lidl': 'lidl-fr', 'mercadona': 'mercadona' };

// Cobertura ponderada (raridade × posição) com PREFIXO. Exportada p/ testes.
export function pontuarBusca(q, candToks, idf) {
  let num = 0, den = 0;
  for (let i = 0; i < q.length; i++) {
    const t = q[i];
    const w = peso(idf, t) * pesoPos(i);
    den += w;
    if (candToks.includes(t)) num += w;
    else if (t.length >= 3 && candToks.some((c) => c.startsWith(t))) num += 0.85 * w; // BOL→bolachas
    else if (t.length >= 5 && candToks.some((c) => c.length >= 4 && t.startsWith(c)))
      num += 0.6 * w; // talão por extenso, catálogo abreviado (raro)
  }
  return den ? num / den : 0;
}

// Formato só compara quando os DOIS lados o declaram EXPLICITAMENTE — o
// extrairFormato devolve {un,1} por omissão, e isso penalizava de borla todo o
// catálogo de nomes limpos (Pingo Doce não embute o tamanho no nome).
const temFormatoExplicito = (s) => /\d\s*(kgs?|grs?|g|ml|cl|lt?|un|dz)\b/i.test(String(s || ''));
function formatoBusca(a, b) {
  if (!temFormatoExplicito(a) || !temFormatoExplicito(b)) return null;
  return formatoCompativel(a, b);
}
// Compara o formato do talão (já parseado) com o formato ESTRUTURADO do candidato
// (colunas do catálogo). Crucial onde o tamanho NÃO está no nome — ex.: Mercadona
// tem "Lixívia Tradicional" 2L e 5L com o MESMO nome (o tamanho vem à parte). Sem
// isto, o matcher escolhia o errado. null = um dos lados não declara → não decide.
function formatoEstrut(fmtQ, fv, ub) {
  if (!fmtQ || fmtQ.formato_valor == null || fv == null || !ub) return null;
  if (fmtQ.unidade_base !== ub) return false;
  const r = Number(fmtQ.formato_valor) / Number(fv);
  return r > 0.8 && r < 1.25;
}

// Devolve o melhor candidato { nome, marca, categoria_path, ean?, fonte, score,
// margem } ou null. `cadeia` dá prior à fonte da mesma loja (marca-própria).
// `margem` = distância ao 2.º melhor de NOME DIFERENTE — margem ~0 significa
// empate entre produtos distintos (ex.: "BANANA" cobre dezenas) → pista não fiável.
export async function buscarCatalogo(pool, descricao, { cadeia, limiar = 0.6, fonteUnica = null } = {}) {
  const idf = await carregarIdf(pool);
  const cat = await catalogoEmMemoria(pool);
  const desc = expandirAbreviaturas(descricao);
  const q = toksB(desc);
  if (!q.length) return null;
  const fmtQ = extrairFormato(descricao); // formato lido do talão (p/ desempate de tamanho)
  const fontePref = FONTE_POR_CADEIA[norm(cadeia || '')] || null;
  // fonteUnica: string OU lista — restringe o universo de candidatos (ex.: o match
  // do talão Mercadona só sobre ['mercadona','mercadona-off'], nunca Continente/Auchan).
  const fontesOk = fonteUnica ? new Set(Array.isArray(fonteUnica) ? fonteUnica : [fonteUnica]) : null;
  const marcados = [];
  for (const r of cat) {
    if (fontesOk && !fontesOk.has(r.fonte)) continue;
    let s = pontuarBusca(q, r.t, idf);
    if (s < 0.45) continue;
    // Só CONFLITO bloqueia (morango ≠ baunilha); faceta AUSENTE passa — o talão
    // abrevia ("NAT") e não dá para expandir deterministicamente; a margem e o
    // LLM (que recebe a pista com instrução de a rejeitar se não encaixar) decidem.
    if (compararFacetas(desc, r.nome) === 'conflito') continue;
    // formato: preferir o ESTRUTURADO do candidato (tamanho à parte do nome, ex.:
    // Mercadona 2L vs 5L com o MESMO nome); senão, parsear o nome (Auchan/Continente).
    let fc = formatoEstrut(fmtQ, r.formato_valor, r.unidade_base);
    if (fc === null) fc = formatoBusca(descricao, r.nome);
    if (fc === true) s += 0.08; else if (fc === false) s -= 0.3; // formato desempata
    if (fontePref && r.fonte === fontePref) s += 0.12; // prior da mesma cadeia
    marcados.push({ r, s });
  }
  if (!marcados.length) return null;
  marcados.sort((a, b) => b.s - a.s);
  const top = marcados[0];
  if (top.s < limiar) return null;
  // margem = distância ao melhor de NOME DIFERENTE (irmãos de tamanho não contam).
  const seg = marcados.find((m) => norm(m.r.nome) !== norm(top.r.nome));
  // alternativas: melhores candidatos de EAN distinto (inclui os irmãos de tamanho,
  // ex.: a lixívia 5L quando a 2L ganhou — para o operador ver os tamanhos e escolher).
  const vistos = new Set([top.r.ean]);
  const alternativas = [];
  for (const m of marcados.slice(1)) {
    if (!m.r.ean || vistos.has(m.r.ean)) continue;
    vistos.add(m.r.ean);
    alternativas.push({ ean: m.r.ean, nome: m.r.nome, formato: m.r.formato || null, score: Math.round(Math.min(1, m.s) * 100) / 100 });
    if (alternativas.length >= 3) break;
  }
  return {
    nome: top.r.nome, marca: top.r.marca || null, categoria_path: top.r.categoria_path || null,
    ean: top.r.ean || null, fonte: top.r.fonte, formato: top.r.formato || null, preco_por_base: top.r.preco_por_base ?? null,
    score: Math.round(Math.min(1, top.s) * 100) / 100, margem: Math.round((top.s - (seg ? seg.s : 0)) * 100) / 100,
    alternativas,
  };
}

// ── Candidatos do Open Food Facts (por nome) ───────────────────────────────
export async function candidatosOFF(item, limite = 8) {
  // termos limpos: tira tokens com dígitos (formato: 330g, 18, 36) e limita a 5
  const termos = toks(`${item.marca || ''} ${item.descricao}`).filter((t) => !/\d/.test(t)).slice(0, 5).join(' ');
  if (!termos) return [];
  try {
    const u = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(termos)}&search_simple=1&action=process&json=1&page_size=${limite}&fields=code,product_name,brands,quantity,nutriscore_grade,nova_group`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(u, { headers: { 'User-Agent': 'Bigbag/0.1 (laboratorio pessoal)' }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.products || [])
      .filter((p) => p.code && p.product_name)
      .map((p) => ({ ean: String(p.code), nome: p.product_name, marca: p.brands || null, origem: 'off', score: pontuar(item, { nome: p.product_name, marca: p.brands }) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limite);
  } catch {
    return [];
  }
}

// ── Juiz LLM: qual candidato é O MESMO produto (ou nenhum)? ─────────────────
async function juiz(item, candidatos) {
  const lista = candidatos.map((c, i) => `${i + 1}. ${c.nome}${c.marca ? ` (${c.marca})` : ''} [EAN ${c.ean}]`).join('\n');
  const messages = [
    { role: 'system', content: 'És um normalizador de produtos de supermercado português. Dada a descrição ABREVIADA de um item de talão e uma lista de candidatos, escolhe o que é EXATAMENTE o mesmo produto (mesma variante, sabor e formato). Se nenhum corresponde com confiança, devolve indice null. Distingue variantes (ex.: caixa de cereais ≠ barras; culinário ≠ leite; 330g ≠ 6x25g). Responde só JSON: {"indice": n|null, "confianca": 0..1, "motivo": "curto"}.' },
    { role: 'user', content: `ITEM DO TALÃO: "${item.descricao}"${item.marca ? ` | marca: ${item.marca}` : ''}\n\nCANDIDATOS:\n${lista}` },
  ];
  try {
    const txt = await chatCompletion({ messages, responseFormat: { type: 'json_object' }, contexto: 'match_produto' });
    const j = JSON.parse(txt);
    const idx = Number.isInteger(j.indice) ? j.indice - 1 : null;
    if (idx == null || idx < 0 || idx >= candidatos.length) return { escolha: null, confianca: 0, motivo: j.motivo };
    return { escolha: candidatos[idx], confianca: Number(j.confianca) || 0, motivo: j.motivo };
  } catch {
    return { escolha: null, confianca: 0, motivo: 'erro juiz' };
  }
}

// ── Orquestrador ───────────────────────────────────────────────────────────
// item: { descricao, marca? }. Devolve { ean, nome, marca, origem, confianca, via } ou null.
export async function resolverProduto(pool, item, { usarLLM = true } = {}) {
  const [cat, off] = await Promise.all([candidatosCatalogo(pool, item), candidatosOFF(item)]);
  const todos = [...cat, ...off].filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  if (!todos.length) return null;

  // Sem LLM: só aceita o topo se a pontuação for forte (token+marca+formato).
  if (!usarLLM) { const top = todos[0]; return top.score >= 0.6 ? { ...top, confianca: top.score, via: 'pontuacao' } : null; }

  // Com LLM: SEMPRE confirma com o juiz (evita falsos positivos de nomes genéricos
  // como "creme de limpeza" → Cif). O juiz distingue variantes e rejeita não-matches.
  const { escolha, confianca, motivo } = await juiz(item, todos.slice(0, 8));
  if (!escolha) return null;
  return { ...escolha, confianca, motivo, via: 'llm' };
}

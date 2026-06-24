// Módulo de medicamentos (Brasil) — COMPARAÇÃO DE PREÇO. Cruza a identidade CMED
// (tabela `medicamento`, por EAN) com os preços praticados pelas farmácias online
// (catalogo_produto, fonte ∈ FARMACIAS) e o histórico (catalogo_preco_hist).
//
// Três ângulos:
//   1) MESMO EAN  → farmácia mais barata + desconto vs PMC (teto legal CMED).
//   2) EQUIVALENTES (mesmo princípio ativo + força + forma) → genérico vs referência,
//      ordenados por PREÇO POR DOSE (R$/comprimido, R$/ml) — comparação justa entre
//      embalagens de tamanhos diferentes.
//   3) BUSCA por nome/substância (FULLTEXT) para o utilizador achar o remédio.
//
// NÃO é aconselhamento médico — só informação e preço (igual ao módulo de saúde).
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { getPool, parseJsonCol } from '../db.js';
import { requireAuth } from '../auth.js';
import { precoPorDose } from '../normaliza/medicamento.js';
import { precoVivoVtex } from '../ingest/precoVivo.js';
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';

export const medicamentoRouter = Router();

// Farmácias online colhidas (fonte em catalogo_produto). Lê o MESMO manifesto que o
// harvester (fonte única) → acrescentar farmácia = editar o JSON + colher, sem mexer
// aqui. Mantém o foco em "farmácia": evita que um supermercado a vender um OTC entre
// como oferta.
const MANIFESTO = JSON.parse(readFileSync(new URL('../../scripts/fontes_farmacia.json', import.meta.url), 'utf8'));
const FARMACIAS = MANIFESTO.map((f) => f.fonte);
// Limiares de FRETE GRÁTIS publicados nas homepages (gerados por scripts/fretes_gratis.mjs).
// Lido com cache de 30 min; tolerante à ausência do ficheiro.
let _fg = null, _fgAt = 0;
function fretesGratisPub() {
  if (_fg && Date.now() - _fgAt < 30 * 60 * 1000) return _fg;
  try { _fg = JSON.parse(readFileSync(new URL('../../scripts/fretes_gratis.json', import.meta.url), 'utf8')); } catch { _fg = {}; }
  _fgAt = Date.now();
  return _fg;
}
const inFarmacias = '(' + FARMACIAS.map(() => '?').join(',') + ')';

const eanLimpo = (e) => { const d = String(e || '').replace(/\D/g, ''); return d.length >= 12 && d.length <= 14 ? d : null; };
// Registo ANVISA: 13 dígitos → "1.YYYY.WWWW.XXX-Z" (produto = 9 primeiros; apresentação = XXX).
const fmtRegistro = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length === 13 ? `${d[0]}.${d.slice(1, 5)}.${d.slice(5, 9)}.${d.slice(9, 12)}-${d[12]}` : (s || null); };
// Nome de ficheiro da imagem (último segmento, sem query), minúsculo.
const fnameImg = (u) => { const s = String(u || '').split('?')[0]; const f = s.slice(s.lastIndexOf('/') + 1); try { return decodeURIComponent(f).toLowerCase(); } catch { return f.toLowerCase(); } };
// Placeholder por PALAVRA-CHAVE no URL (rápido; apanha os óbvios).
const imgPlaceholderUrl = (u) => !u || /generic|tarja|sem.?imagem|sem.?foto|sem_imagem|rotulo|placeholder|default|no.?image|indispon|controlad|rx.?n[aã]o|medicamento\.jpg|de.?refer[eê]ncia|comprimido_vermelha|consulte/i.test(String(u));
// Placeholders por FREQUÊNCIA: um ficheiro reutilizado em ≥15 EANs é genérico de farmácia
// (apanha os que não têm palavra-chave, ex.: "medicamento.jpg.jpg", "rx-nao-controlado.jpg").
// Calculado 1× e cacheado 6h (as colheitas mudam as imagens devagar).
let _ph = null, _phAt = 0;
async function placeholders(pool) {
  if (_ph && Date.now() - _phAt < 6 * 3600 * 1000) return _ph;
  try {
    const [rows] = await pool.query(
      `SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(imagem_url, '?', 1), '/', -1) f, COUNT(DISTINCT ean) n
         FROM catalogo_produto WHERE imagem_url IS NOT NULL AND imagem_url <> '' AND fonte IN ${inFarmacias}
        GROUP BY f HAVING n >= 15`, FARMACIAS);
    _ph = new Set(rows.map((r) => String(r.f).toLowerCase())); _phAt = Date.now();
  } catch { _ph = _ph || new Set(); }
  return _ph;
}
const ehPlaceholder = (u, ph) => imgPlaceholderUrl(u) || (!!ph && ph.has(fnameImg(u)));

// Ofertas (farmácias) para um EAN, da mais barata para a mais cara.
async function ofertasDoEan(pool, ean) {
  const [rows] = await pool.query(
    `SELECT fonte, preco, preco_cond, preco_cond_obs, url, imagem_url, nome, scraped_at
       FROM catalogo_produto
      WHERE ean = ? AND moeda = 'BRL' AND preco > 0 AND fonte IN ${inFarmacias}
      ORDER BY preco ASC`,
    [ean, ...FARMACIAS],
  );
  return rows.map((r) => ({ ...r, preco: Number(r.preco), preco_cond: r.preco_cond == null ? null : Number(r.preco_cond) }));
}

// Escolhe a MELHOR foto entre TODAS as imagens do produto: o EAN consultado + os EANs
// IRMÃOS do mesmo registro ANVISA + forma, em todas as farmácias. GARANTE a foto certa
// por pontuação — ficheiro nomeado pelo EAN (`7898074617612-Fluimucil.jpg`) = foto real
// daquele produto; depois a imagem do próprio EAN; depois um nome descritivo. Os
// placeholders (palavra-chave OU reutilizados em ≥15 EANs) são sempre excluídos.
// Tamanho (bytes) de uma imagem por HEAD — cacheado. Placeholders são otimizados
// (pequenos); fotos reais são maiores → o peso é um sinal forte para desempatar.
const _sz = new Map();
async function tamanhoImagem(url) {
  if (_sz.has(url)) return _sz.get(url);
  let bytes = null;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(2500), headers: { 'user-agent': 'Mozilla/5.0 (compatible; BigBag/1.0)' } });
    const cl = Number(r.headers.get('content-length'));
    if (r.ok && Number.isFinite(cl) && cl > 0) bytes = cl;
  } catch { /* CDN lento/geo/sem HEAD → desconhecido */ }
  if (_sz.size > 8000) _sz.clear();
  _sz.set(url, bytes);
  return bytes;
}
async function escolherImagem(pool, med, eanConsultado, ph) {
  const reg = String(med.registro || '');
  const [rows] = await pool.query(
    `SELECT cp.ean, cp.imagem_url url FROM catalogo_produto cp JOIN medicamento m ON m.ean = cp.ean
      WHERE (cp.ean = ? OR (LENGTH(?) = 13 AND LEFT(m.registro, 9) = ? AND m.forma <=> ?))
        AND cp.imagem_url IS NOT NULL AND cp.imagem_url <> '' AND cp.fonte IN ${inFarmacias} LIMIT 150`,
    [eanConsultado, reg, reg.slice(0, 9), med.forma, ...FARMACIAS],
  );
  const cands = [];
  const vistos = new Set();
  for (const r of rows) {
    if (ehPlaceholder(r.url, ph) || vistos.has(r.url)) continue;
    vistos.add(r.url);
    const fn = fnameImg(r.url);
    const own = String(r.ean) === String(eanConsultado);
    const temEan = fn.includes(String(r.ean));               // ficheiro nomeado pelo EAN → foto certa
    const descritivo = fn.replace(/[^a-z]/gi, '').length >= 6; // tem letras (não é só números genéricos)
    cands.push({ url: r.url, s: own && temEan ? 5 : own ? 4 : temEan ? 3 : descritivo ? 1 : 0.2 });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.s - a.s);
  const top = cands.slice(0, 6); // só os melhores vão a HEAD (limita latência)
  const sizes = await Promise.all(top.map((c) => tamanhoImagem(c.url)));
  top.forEach((c, i) => { c.bytes = sizes[i]; });
  // ranking final: penaliza minúsculos (<8 KB, provável placeholder); desempate pelo MAIOR peso.
  top.sort((a, b) => {
    const pa = a.s + (a.bytes != null && a.bytes < 8000 ? -2 : a.bytes >= 25000 ? 0.5 : 0);
    const pb = b.s + (b.bytes != null && b.bytes < 8000 ? -2 : b.bytes >= 25000 ? 0.5 : 0);
    return pb - pa || (b.bytes || 0) - (a.bytes || 0);
  });
  return top[0].url;
}

// Equivalentes QUE TÊM oferta, com o menor preço e o preço por dose. Classe de equivalência =
// substancia × forma × FORÇA_EFETIVA × forca_valor_max (Cluster 2). FORÇA_EFETIVA =
// COALESCE(medicamento_curado.forca_valor, m.dose_valor) — curada (força clínica real) p/ os
// injetáveis GLP-1 cuja CMED só traz a CONCENTRAÇÃO; estrutural p/ os orais (Rybelsus já certo).
// ISOLAMENTO ESTRUTURAL por `forca_valor_max <=>` (NULL-safe): uma FAIXA de início (caneta dual
// 0,25/0,5, max não-nulo) nunca se mistura com força exata (max=NULL). `papel` é só rótulo. QTD
// EFETIVA = COALESCE(qtd_embalagem_corr, m.qtd_embalagem) no denominador (resolve o ÷0 do Mounjaro).
async function equivalentesComOferta(pool, med) {
  const [[cur]] = await pool.query('SELECT forca_valor, forca_valor_max, forca_unidade FROM medicamento_curado WHERE ean=?', [med.ean]);
  const forcaValor = cur && cur.forca_valor != null ? Number(cur.forca_valor) : (med.dose_valor == null ? null : Number(med.dose_valor));
  const forcaUnidade = cur && cur.forca_unidade != null ? cur.forca_unidade : med.dose_unidade;
  const forcaMax = cur && cur.forca_valor_max != null ? Number(cur.forca_valor_max) : null;
  if (med.forma == null || forcaValor == null || forcaUnidade == null) return [];
  const [rows] = await pool.query(
    `SELECT m.ean, m.registro, m.produto, m.laboratorio, m.tipo, m.generico, m.forma, m.pmc_18,
            COALESCE(mc.qtd_embalagem_corr, m.qtd_embalagem) AS qtd_ef,
            COALESCE(mc.forca_valor, m.dose_valor) AS forca_ef, COALESCE(mc.forca_unidade, m.dose_unidade) AS forca_un,
            COALESCE(mc.papel, 'manutencao') AS papel,
            MIN(cp.preco) menor_preco, COUNT(DISTINCT cp.fonte) n_farmacias
       FROM medicamento m
       LEFT JOIN medicamento_curado mc ON mc.ean = m.ean
       JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco > 0 AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarmacias}
      WHERE m.substancia <=> ? AND m.forma = ?
        AND COALESCE(mc.forca_valor, m.dose_valor) = ?
        AND COALESCE(mc.forca_unidade, m.dose_unidade) = ?
        AND mc.forca_valor_max <=> ?
      GROUP BY m.ean
      ORDER BY (MIN(cp.preco) / NULLIF(COALESCE(mc.qtd_embalagem_corr, m.qtd_embalagem), 0)) ASC, menor_preco ASC`,
    [...FARMACIAS, med.substancia, med.forma, forcaValor, forcaUnidade, forcaMax],
  );
  return rows.map((r) => ({
    ean: r.ean, registro: r.registro, produto: r.produto, laboratorio: r.laboratorio, tipo: r.tipo,
    generico: !!r.generico, forma: r.forma, qtd_embalagem: r.qtd_ef,
    forca_valor: r.forca_ef == null ? null : Number(r.forca_ef), forca_unidade: r.forca_un, papel: r.papel,
    menor_preco: r.menor_preco == null ? null : Number(r.menor_preco),
    preco_por_dose: precoPorDose(r.menor_preco, r.qtd_ef),
    n_farmacias: r.n_farmacias, referencia: r.ean === med.ean,
  }));
}

// GET /api/medicamento/info?ean=  → ficha + ofertas + comparação + equivalentes.
// PÚBLICO (utilidade pública, sem login): só preço e informação de medicamentos —
// dados públicos, sem PII nem nada por-utilizador. Serve a superfície /remedios.
medicamentoRouter.get('/info', async (req, res) => {
  try {
    const ean = eanLimpo(req.query.ean);
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    const pool = getPool();
    const [[med]] = await pool.query('SELECT * FROM medicamento WHERE ean = ?', [ean]);
    if (!med) return res.status(404).json({ erro: 'medicamento não encontrado na base CMED', ean });
    med.pmc_por_icms = parseJsonCol(med.pmc_por_icms);
    med.pf_por_icms = parseJsonCol(med.pf_por_icms);

    const ofertas = await ofertasDoEan(pool, ean);
    const ph = await placeholders(pool); // conjunto de imagens-placeholder (por frequência)
    const melhor = ofertas[0] || null; // mais barato NORMAL (base honesta — todos pagam)
    // menor preço ACHIEVABLE com desconto CONDICIONAL (ex.: PBM/laboratório, exige cadastro),
    // só se for abaixo do melhor normal — p/ deixar claro "pode chegar a R$X com desconto".
    const comCond = ofertas.filter((o) => o.preco_cond != null && o.preco_cond > 0 && o.preco_cond < (melhor ? melhor.preco : Infinity));
    const melhorCond = comCond.length ? comCond.reduce((a, b) => (b.preco_cond < a.preco_cond ? b : a)) : null;
    const pmc = med.pmc_18 == null ? null : Number(med.pmc_18);
    const comparacao = melhor && pmc != null ? {
      pmc, melhor_preco: melhor.preco, melhor_fonte: melhor.fonte,
      economia_vs_pmc: Math.round((pmc - melhor.preco) * 100) / 100,
      pct_vs_pmc: pmc > 0 ? Math.round((1 - melhor.preco / pmc) * 1000) / 10 : null, // % abaixo do teto
    } : null;

    // Mesma substância+dose+forma. Separa o MESMO produto registado (outras embalagens =
    // outros tamanhos do próprio remédio, pelo registro ANVISA dos 9 dígitos) dos
    // EQUIVALENTES de outras marcas/genéricos — não faz sentido listar o próprio produto
    // como "equivalente". Sem registro na referência, cai no nome da marca.
    const todosEquiv = await equivalentesComOferta(pool, med);
    const reg9 = (s) => (s && String(s).length >= 13 ? String(s).slice(0, 9) : null);
    const r9 = reg9(med.registro);
    const normNome = (s) => String(s || '').toUpperCase().trim();
    const mesmoProduto = (e) => (r9 ? reg9(e.registro) === r9 : normNome(e.produto) === normNome(med.produto));
    const outrasEmbalagens = todosEquiv.filter(mesmoProduto);            // inclui a referência (ESTE)
    // EQUIVALENTES = outras marcas/genéricos, DEDUPADOS por produto registado (registro9;
    // fallback nome) → 1 entrada por marca, a de melhor preço/un (senão a mesma marca repete
    // uma linha por embalagem, ex.: OZIVY 3×).
    const porProduto = new Map();
    for (const e of todosEquiv) {
      if (mesmoProduto(e)) continue;
      const k = reg9(e.registro) || normNome(e.produto);
      const ex = porProduto.get(k);
      if (!ex) { porProduto.set(k, e); continue; }
      const ppd = e.preco_por_dose, exp = ex.preco_por_dose;
      const melhor = ppd != null && exp != null ? ppd < exp : ppd != null ? true : Number(e.menor_preco) < Number(ex.menor_preco);
      if (melhor) porProduto.set(k, e);
    }
    const equivalentes = [...porProduto.values()]
      .sort((a, b) => (a.preco_por_dose ?? 9e9) - (b.preco_por_dose ?? 9e9)).slice(0, 12);
    const maisBaratoEquivalente = equivalentes.find((e) => e.preco_por_dose != null) || null;

    res.json({
      ean, identidade: {
        produto: med.produto, substancia: med.substancia, apresentacao: med.apresentacao,
        laboratorio: med.laboratorio, tipo: med.tipo, generico: !!med.generico, tarja: med.tarja, categoria_anvisa: med.categoria_anvisa,
        classe_terapeutica: med.classe_terapeutica, dosagem: med.dosagem, forma: med.forma,
        qtd_embalagem: med.qtd_embalagem, restricao_hospitalar: !!med.restricao_hospitalar,
        registro: med.registro || null, registro_fmt: fmtRegistro(med.registro), cmed_versao: med.cmed_versao,
      },
      tetos: { pf: med.pf == null ? null : Number(med.pf), pmc_18: pmc, pmc_por_icms: med.pmc_por_icms },
      imagem: await escolherImagem(pool, med, ean, ph),
      ofertas, melhor, melhor_cond: melhorCond, comparacao, outras_embalagens: outrasEmbalagens, equivalentes, mais_barato_equivalente: maisBaratoEquivalente,
    });
  } catch (e) { console.error('[medicamento/info]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /api/medicamento/equivalentes?ean=  → só a lista de equivalentes (genérico vs referência).
medicamentoRouter.get('/equivalentes', async (req, res) => {
  try {
    const ean = eanLimpo(req.query.ean);
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    const pool = getPool();
    const [[med]] = await pool.query('SELECT ean, substancia, dose_valor, dose_unidade, forma FROM medicamento WHERE ean = ?', [ean]);
    if (!med) return res.status(404).json({ erro: 'medicamento não encontrado', ean });
    res.json({ ean, substancia: med.substancia, dosagem: `${med.dose_valor ?? ''} ${med.dose_unidade ?? ''}`.trim(), forma: med.forma, equivalentes: await equivalentesComOferta(pool, med) });
  } catch (e) { console.error('[medicamento/equivalentes]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /api/medicamento/buscar?q=  → busca por nome/substância (FULLTEXT), só com oferta.
medicamentoRouter.get('/buscar', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.json({ q, resultados: [] });
    const pool = getPool();
    // BOOLEAN: último token como prefixo (autocomplete).
    const toks = q.split(/\s+/).filter(Boolean);
    const expr = toks.map((t, i) => '+' + t.replace(/[+\-><()~*"@]/g, '') + (i === toks.length - 1 ? '*' : '')).join(' ');
    const [rows] = await pool.query(
      `SELECT m.ean, m.registro, m.produto, m.substancia, m.laboratorio, m.generico, m.dosagem, m.forma, m.qtd_embalagem,
              MIN(cp.preco) menor_preco, COUNT(DISTINCT cp.fonte) n_farmacias
         FROM medicamento m
         JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco > 0
          AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarmacias}
        WHERE MATCH(m.produto, m.substancia) AGAINST (? IN BOOLEAN MODE)
        GROUP BY m.ean
        ORDER BY n_farmacias DESC, menor_preco ASC
        LIMIT 150`,
      [...FARMACIAS, expr],
    );
    // DEDUP pelo REGISTRO ANVISA — a certeza oficial. O nº tem a forma 1.YYYY.WWWW.XXX-Z:
    // os 9 primeiros dígitos = o PRODUTO registado, os 3 seguintes = a apresentação (pack).
    // Logo o MESMO remédio (vários tamanhos de embalagem) partilha LEFT(registro,9). Junta-se
    // +dosagem+forma porque um produto-registo pode cobrir várias forças (50/100 mg) → mantê-las
    // separadas. Representante = melhor PREÇO POR DOSE (R$/un — comparação justa entre tamanhos).
    const reg9 = (s) => (s && String(s).length >= 13 ? String(s).slice(0, 9) : null);
    const grupos = new Map();
    for (const r of rows) {
      const p9 = reg9(r.registro);
      const key = p9
        ? `R:${p9}|${r.dosagem || ''}|${r.forma || ''}`
        : `N:${String(r.produto || '').toUpperCase().trim()}|${r.dosagem || ''}|${r.forma || ''}`; // sem registro → cai no match por nome
      const ppd = precoPorDose(r.menor_preco, r.qtd_embalagem);
      const ex = grupos.get(key);
      if (!ex) { grupos.set(key, { ...r, ppd, nf: r.n_farmacias }); continue; }
      ex.nf = Math.max(ex.nf, r.n_farmacias);
      const melhor = ppd != null && ex.ppd != null ? ppd < ex.ppd
        : ppd != null && ex.ppd == null ? true
          : Number(r.menor_preco) < Number(ex.menor_preco);
      if (melhor) grupos.set(key, { ...r, ppd, nf: ex.nf });
    }
    // as apresentações (1 por dosagem/forma do produto-registo)
    const apres = [...grupos.values()].map((r) => ({
      ean: r.ean, produto: r.produto, substancia: r.substancia, laboratorio: r.laboratorio,
      generico: !!r.generico, dosagem: r.dosagem, forma: r.forma, qtd_embalagem: r.qtd_embalagem,
      menor_preco: r.menor_preco == null ? null : Number(r.menor_preco),
      preco_por_dose: r.ppd, n_farmacias: r.nf,
    }));
    // 2.º nível — agrupa as apresentações por MARCA (produto) → UMA entrada por remédio na
    // busca; as variantes (forma/dosagem) ficam dentro, para a tela de "escolher apresentação".
    const marcas = new Map();
    for (const a of apres) {
      const k = String(a.produto || '').toUpperCase().trim();
      const m = marcas.get(k);
      if (!m) { marcas.set(k, { produto: a.produto, substancia: a.substancia, generico: a.generico, menor_preco: a.menor_preco, n_farmacias: a.n_farmacias, apresentacoes: [a] }); continue; }
      m.apresentacoes.push(a);
      if (a.menor_preco != null && (m.menor_preco == null || a.menor_preco < m.menor_preco)) m.menor_preco = a.menor_preco;
      m.n_farmacias = Math.max(m.n_farmacias, a.n_farmacias);
      m.generico = m.generico || a.generico;
    }
    // Ordena as apresentações AGRUPADAS por forma → dosagem; só DENTRO de cada (forma+dose)
    // o preço/dose é comparável (R$/comprimido vs R$/ml não se comparam). Nunca um ranking
    // único cruzando formas.
    const ordApres = (x, y) => String(x.forma || '').localeCompare(String(y.forma || ''))
      || String(x.dosagem || '').localeCompare(String(y.dosagem || ''), undefined, { numeric: true })
      || (x.preco_por_dose ?? 9e9) - (y.preco_por_dose ?? 9e9);
    const resultados = [...marcas.values()]
      .map((m) => ({ ...m, n_apresentacoes: m.apresentacoes.length, apresentacoes: m.apresentacoes.sort(ordApres) }))
      .sort((a, b) => b.n_farmacias - a.n_farmacias || Number(a.menor_preco) - Number(b.menor_preco))
      .slice(0, 25);
    res.json({ q, resultados });
  } catch (e) { console.error('[medicamento/buscar]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /api/medicamento/precos-ao-vivo?ean=&cep=  → preço + FRETE AO VIVO de um remédio
// (só no clique deliberado). Consulta TODAS as farmácias VTEX em paralelo (proxy nas geo),
// com timeout curto; quem não responde fica com a cache. Debounce 5 min por (ean,cep).
// Alimenta o histórico: cada mudança de preço entra em catalogo_preco_hist.
const _vivo = new Map(); // `${ean}|${cep}` → { at, data }
medicamentoRouter.get('/precos-ao-vivo', async (req, res) => {
  try {
    const ean = eanLimpo(req.query.ean);
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    const cep = String(req.query.cep || '22241040').replace(/\D/g, '').slice(0, 8) || '22241040';
    const key = `${ean}|${cep}`;
    const ja = _vivo.get(key);
    if (ja && Date.now() - ja.at < 5 * 60 * 1000) return res.json({ ...ja.data, cache_ms: Date.now() - ja.at });

    const vtex = MANIFESTO.filter((f) => (f.motor || 'vtex') === 'vtex');
    const got = await Promise.allSettled(vtex.map((f) => precoVivoVtex(f.host, ean, cep, { proxy: !!f.geo }).then((r) => (r && r.existe ? { fonte: f.fonte, ...r } : null))));
    const fontes = got.filter((x) => x.status === 'fulfilled' && x.value).map((x) => x.value)
      .sort((a, b) => (a.total ?? a.preco ?? 9e9) - (b.total ?? b.preco ?? 9e9));
    // limiar de frete grátis: o PUBLICADO (exato) tem prioridade sobre a estimativa por simulação.
    // só o VALOR do limiar (publicado é geral, não por CEP) — NÃO marca entrega/frete_gratis_maiores,
    // que são os sinais ESPECÍFICOS do CEP (da simulação) usados para decidir se entrega ali.
    const fgPub = fretesGratisPub();
    for (const f of fontes) { const p = fgPub[f.fonte]; if (p && p.acima) f.frete_gratis_acima = p.acima; }

    // write-back: preço mudou → atualiza catalogo_produto + histórico append-only.
    const pool = getPool();
    for (const f of fontes) {
      if (f.preco == null || !f.sku) continue;
      try {
        const [[cur]] = await pool.query('SELECT preco FROM catalogo_produto WHERE fonte=? AND ean=? LIMIT 1', [f.fonte, ean]);
        const ant = cur && cur.preco != null ? Number(cur.preco) : null;
        if (ant === null || ant !== Number(f.preco)) {
          await pool.query('UPDATE catalogo_produto SET preco=?, scraped_at=NOW() WHERE fonte=? AND ean=?', [f.preco, f.fonte, ean]);
          await pool.query('INSERT INTO catalogo_preco_hist (fonte, sku_fonte, ean, preco, moeda, visto_em) VALUES (?,?,?,?,?,NOW())', [f.fonte, f.sku, ean, f.preco, 'BRL']);
        }
      } catch { /* write-back é best-effort */ }
    }
    const melhor = fontes.find((f) => f.entrega && f.total != null) || fontes[0] || null;
    const data = { ean, cep, agora: new Date().toISOString(), fontes, melhor_entrega: melhor };
    _vivo.set(key, { at: Date.now(), data });
    if (_vivo.size > 3000) _vivo.clear();
    res.json(data);
  } catch (e) { console.error('[medicamento/precos-ao-vivo]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /api/medicamento/explicacao?ean=  → "Para que serve" em LINGUAGEM SIMPLES, gerado
// por LLM e FUNDAMENTADO no princípio ativo + classe (NÃO no texto da bula). Cacheado por
// substância (mesma explicação p/ todas as marcas/genéricos do ativo). INFORMAÇÃO, não
// aconselhamento médico — o prompt é conservador e os disclaimers vão no texto/UI.
const PROMPT_EXPL = (sub, classe, forma, nome) => `Você é um farmacêutico que explica remédios em linguagem MUITO SIMPLES e CLARA para leigos no Brasil (PT-BR, trate por "você"). Com base APENAS no princípio ativo e na classe abaixo, devolva um JSON:
{"para_que_serve":"1 a 2 frases curtas: para que serve este remédio, no dia a dia","como_usar":"1 frase GERAL (ex.: via oral; siga a bula e o médico) — SEM dose, quantidade ou horários","cuidados":"1 a 2 frases: cuidados gerais e quando procurar ajuda (alergia, gravidez/amamentação, álcool, etc.)"}
Regras: seja conciso e em linguagem do dia a dia; NÃO invente; se NÃO tiver certeza do princípio ativo, escreva em "para_que_serve" para consultar a bula; NUNCA dê posologia (quantidade/horário) nem recomendação personalizada. Responda SÓ o JSON.
Princípio ativo: ${sub}
Classe terapêutica: ${classe || '(não informada)'}
Forma: ${forma || '(não informada)'}
Nome comercial: ${nome || '(não informado)'}`;

medicamentoRouter.get('/explicacao', async (req, res) => {
  try {
    const ean = eanLimpo(req.query.ean);
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    const pool = getPool();
    const [[med]] = await pool.query('SELECT substancia, principio_ativo, classe_terapeutica, produto, forma FROM medicamento WHERE ean = ?', [ean]);
    if (!med) return res.status(404).json({ erro: 'medicamento não encontrado' });
    const sub = String(med.principio_ativo || med.substancia || '').trim();
    if (!sub) return res.json({ explicacao: null });
    const chave = sub.toUpperCase().replace(/\s+/g, ' ').slice(0, 190);
    const [[cache]] = await pool.query('SELECT para_que_serve, como_usar, cuidados FROM medicamento_explicacao WHERE chave = ?', [chave]);
    if (cache) return res.json({ substancia: sub, ...cache, cache: true });
    let out;
    try {
      const txt = await chatCompletion({
        messages: [{ role: 'user', content: PROMPT_EXPL(sub, med.classe_terapeutica, med.forma, med.produto) }],
        model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' },
        timeoutMs: 20000, contexto: 'explicacao_medicamento',
      });
      out = JSON.parse(txt);
    } catch (e) { console.error('[explicacao] LLM:', e.message); return res.json({ explicacao: null }); }
    const v = (s) => (s ? String(s).slice(0, 600) : null);
    await pool.query(
      `INSERT INTO medicamento_explicacao (chave, substancia, para_que_serve, como_usar, cuidados, modelo)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE para_que_serve=VALUES(para_que_serve),
         como_usar=VALUES(como_usar), cuidados=VALUES(cuidados), modelo=VALUES(modelo)`,
      [chave, sub, v(out.para_que_serve), v(out.como_usar), v(out.cuidados), config.openrouter.modelConsulta],
    );
    res.json({ substancia: sub, para_que_serve: v(out.para_que_serve), como_usar: v(out.como_usar), cuidados: v(out.cuidados) });
  } catch (e) { console.error('[medicamento/explicacao]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /api/medicamento/monitor?ean=&dias=30  → histórico denso de preço+estoque dos remédios
// monitorados (tabela medicamento_monitor_hist, colhida 4/4h). Público (sem PII).
medicamentoRouter.get('/monitor', async (req, res) => {
  try {
    const ean = eanLimpo(req.query.ean);
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    const dias = Math.min(180, Math.max(1, Number(req.query.dias) || 30));
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT fonte, preco, preco_cond, disponivel, capturado_em FROM medicamento_monitor_hist
        WHERE ean = ? AND capturado_em >= (NOW() - INTERVAL ? DAY)
        ORDER BY capturado_em ASC`, [ean, dias]);
    const precos = rows.filter((r) => r.preco != null).map((r) => Number(r.preco));
    const conds = rows.filter((r) => r.preco_cond != null).map((r) => Number(r.preco_cond));
    res.json({
      ean, dias, pontos: rows.length,
      ultimo: rows.length ? rows[rows.length - 1].capturado_em : null,
      preco_min: precos.length ? Math.min(...precos) : null,
      preco_max: precos.length ? Math.max(...precos) : null,
      preco_cond_min: conds.length ? Math.min(...conds) : null, // menor com desconto de laboratório (PBM)
      pct_em_estoque: rows.length ? Math.round((rows.filter((r) => r.disponivel).length / rows.length) * 1000) / 10 : null,
      historico: rows.map((r) => ({ fonte: r.fonte, preco: r.preco == null ? null : Number(r.preco), preco_cond: r.preco_cond == null ? null : Number(r.preco_cond), disponivel: !!r.disponivel, em: r.capturado_em })),
    });
  } catch (e) { console.error('[medicamento/monitor]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// Rótulo HUMANO de força a partir da CURADA (nunca a concentração crua "1,34 mg/ml").
function rotuloForca(r) {
  const fmt = (n) => (n == null ? '' : String(Number(n)).replace('.', ','));
  const per = r.forca_periodicidade ? `/${r.forca_periodicidade}` : '';
  if (r.forca_valor != null) {
    const un = r.forca_unidade || 'mg';
    if (r.papel === 'inicio' && r.forca_valor_max != null) return `dose de início ${fmt(r.forca_valor)}–${fmt(r.forca_valor_max)} ${un}${per}`;
    if (r.papel === 'inicio') return `dose de início ${fmt(r.forca_valor)} ${un}${per}`;
    return `${fmt(r.forca_valor)} ${un}${per}`;
  }
  if (r.dose_unidade && /\//.test(r.dose_unidade)) return 'força a curar'; // injetável sem curar → não expor concentração
  return r.dose_valor != null ? `${fmt(r.dose_valor)} ${String(r.dose_unidade || '').toLowerCase()}`.trim() : '—';
}

// GET /api/medicamento/catalogo?marca=Ozempic | ?registro=1176600360 — CATÁLOGO HIERÁRQUICO
// (read-only). Parte da IDENTIDADE CMED (todas as apresentações da marca, COM e SEM oferta) →
// apresentações (rótulo de força CURADA, ordem clínica crescente, com-oferta primeiro / sem-oferta
// rebaixada) → farmácias por apresentação (ordenadas por preço). Comparação de preço SÓ no nível 3
// (dentro de uma apresentação). Só fontes FARMÁCIA. Guard do Cluster 1 respeitado (preco>0).
medicamentoRouter.get('/catalogo', async (req, res) => {
  try {
    const marca = String(req.query.marca || '').trim();
    const reg9 = String(req.query.registro || '').replace(/\D/g, '').slice(0, 9);
    if (!marca && !reg9) return res.status(400).json({ erro: 'informe ?marca= ou ?registro=' });
    const pool = getPool();
    const cond = marca ? 'UPPER(m.produto) = ?' : 'LEFT(m.registro,9) = ?';
    const arg = marca ? marca.toUpperCase() : reg9;
    // NÍVEL 1+2: apresentações (identity-first; LEFT JOIN curado + agregado de ofertas p/ COM/SEM_OFERTA)
    const [apres] = await pool.query(
      `SELECT m.ean, m.produto, m.substancia, m.forma, m.dose_valor, m.dose_unidade, m.registro, m.tarja,
              mc.forca_valor, mc.forca_valor_max, mc.forca_unidade, mc.forca_periodicidade, mc.papel,
              COALESCE(mc.qtd_embalagem_corr, m.qtd_embalagem) AS qtd_ef,
              COALESCE(mc.forca_valor, m.dose_valor) AS forca_ef, COALESCE(mc.forca_unidade, m.dose_unidade) AS forca_un,
              COUNT(DISTINCT cp.fonte) AS n_ofertas
         FROM medicamento m
         LEFT JOIN medicamento_curado mc ON mc.ean = m.ean
         LEFT JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco > 0 AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarmacias}
        WHERE ${cond}
        GROUP BY m.ean`, [...FARMACIAS, arg]);
    if (!apres.length) return res.status(404).json({ erro: 'marca/registro sem apresentações na CMED' });
    const eans = apres.map((a) => a.ean);
    const inEans = '(' + eans.map(() => '?').join(',') + ')';
    // NÍVEL 3: ofertas por farmácia (todas as apresentações de uma vez; ordem por preço)
    const [ofertas] = await pool.query(
      `SELECT ean, fonte, preco, preco_cond, preco_cond_obs, url, TIMESTAMPDIFF(HOUR, scraped_at, NOW()) frescor_h
         FROM catalogo_produto WHERE ean IN ${inEans} AND preco > 0 AND moeda = 'BRL' AND fonte IN ${inFarmacias}
        ORDER BY preco ASC`, [...eans, ...FARMACIAS]);
    // estoque: último snapshot do monitor por (ean,fonte)
    const [stk] = await pool.query(
      `SELECT t.ean, t.fonte, t.disponivel, t.qtd_estoque FROM medicamento_monitor_hist t
         JOIN (SELECT ean, fonte, MAX(capturado_em) mx FROM medicamento_monitor_hist WHERE ean IN ${inEans} GROUP BY ean, fonte) g
           ON g.ean = t.ean AND g.fonte = t.fonte AND g.mx = t.capturado_em`, eans);
    const stkMap = new Map(stk.map((s) => [`${s.ean}|${s.fonte}`, s]));
    // SINAL de programa de laboratório (camada QUALITATIVA, postura 2) — ADITIVO, não toca preço.
    // SÓ exibível: VALIDADO E não-expirado. Quarentena (DETECTADO) e EXPIRADO NUNCA aparecem.
    const [sinais] = await pool.query(
      `SELECT ean, fonte, programa_detectado, ultima_confirmacao, DATEDIFF(NOW(), ultima_confirmacao) idade_dias
         FROM programa_sinal WHERE ean IN ${inEans} AND estado_validacao = 'VALIDADO' AND expira_em > NOW()`, eans);
    const sigMap = new Map(sinais.map((s) => [`${s.ean}|${s.fonte}`, s]));
    // alternativas mesma força: toda a substancia+forma de uma vez (agrupado depois em JS)
    const sub = apres[0].substancia, forma = apres[0].forma;
    const [alt] = await pool.query(
      `SELECT m.produto, m.ean, COALESCE(mc.forca_valor, m.dose_valor) fv, COALESCE(mc.forca_unidade, m.dose_unidade) fu,
              mc.forca_valor_max fmax, MIN(cp.preco) menor, COUNT(DISTINCT cp.fonte) nf
         FROM medicamento m LEFT JOIN medicamento_curado mc ON mc.ean = m.ean
         JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco > 0 AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarmacias}
        WHERE m.substancia <=> ? AND m.forma = ? GROUP BY m.ean`, [...FARMACIAS, sub, forma]);

    const ofPorEan = new Map();
    for (const o of ofertas) { if (!ofPorEan.has(o.ean)) ofPorEan.set(o.ean, []); ofPorEan.get(o.ean).push(o); }
    const lista = apres.map((a) => {
      const fef = a.forca_ef == null ? null : Number(a.forca_ef);
      const fmax = a.forca_valor_max == null ? null : Number(a.forca_valor_max);
      const farmacias = (ofPorEan.get(a.ean) || []).map((o) => {
        const s = stkMap.get(`${a.ean}|${o.fonte}`);
        const pg = sigMap.get(`${a.ean}|${o.fonte}`); // sinal qualitativo (só VALIDADO+não-expirado)
        return { fonte: o.fonte, preco: Number(o.preco),
          preco_cond: o.preco_cond == null ? null : Number(o.preco_cond), preco_cond_obs: o.preco_cond_obs,
          disponivel: s && s.disponivel != null ? !!s.disponivel : null, qtd_estoque: s ? s.qtd_estoque : null,
          frescor_h: o.frescor_h, url: o.url,
          // ADITIVO: aparece SÓ quando há sinal exibível; qualitativo, separado do preço (postura 2)
          ...(pg ? { programa: { nome: pg.programa_detectado, desde: pg.ultima_confirmacao, idade_dias: pg.idade_dias, estado: 'VALIDADO' } } : {}) };
      });
      const alternativas = alt.filter((x) => x.produto !== a.produto && Number(x.fv) === fef
          && (x.fmax == null ? null : Number(x.fmax)) === fmax && String(x.fu) === String(a.forca_un))
        .map((x) => ({ marca: x.produto, ean: x.ean, menor_preco: Number(x.menor), n_farmacias: x.nf }))
        .sort((p, q) => p.menor_preco - q.menor_preco);
      return {
        ean: a.ean, registro: fmtRegistro(a.registro),
        rotulo_forca: rotuloForca(a),
        forca_valor: fef, forca_valor_max: fmax, forca_unidade: a.forca_un, papel: a.papel || (a.forca_valor != null ? 'manutencao' : null),
        qtd_efetiva: a.qtd_ef,
        estado: a.n_ofertas > 0 ? 'COM_OFERTA' : 'SEM_OFERTA',
        farmacias,
        alternativas_mesma_forca: alternativas,
        nota_alternativas: alternativas.length ? 'Mesma substância e força — NÃO é genérico oficial; troca exige decisão médica. Não substitui a marca pedida.' : null,
      };
    });
    // ordena: COM_OFERTA primeiro, depois FORÇA CLÍNICA crescente (ordem clínica, não preço)
    lista.sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'COM_OFERTA' ? -1 : 1) || (a.forca_valor ?? 9e9) - (b.forca_valor ?? 9e9));
    res.json({ marca: apres[0].produto, substancia: sub, forma, tarja: apres[0].tarja,
      n_apresentacoes: lista.length, com_oferta: lista.filter((x) => x.estado === 'COM_OFERTA').length, apresentacoes: lista });
  } catch (e) { console.error('[medicamento/catalogo]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// ───────────────────────── Trilho A — monitor de preço POR USUÁRIO ─────────────────────────
// Dado de saúde = SENSÍVEL → TUDO atrás de requireAuth, sempre filtrado por req.user.id. Um
// usuário NUNCA vê monitor/alerta de outro. O gatilho (motor) é dry-run (grava alerta_log
// entregue=0); a entrega/push é a tarefa seguinte.

// Preços de mercado de um EAN (tabela, ofertas COM estoque): prefere o snapshot denso (fresco,
// stock-filtrado); cai no catálogo se o denso ainda não cobre o EAN. Devolve ordenado asc.
async function precosMercado(pool, ean) {
  const [snaps] = await pool.query(
    `SELECT t.fonte, t.preco, t.disponivel FROM medicamento_monitor_hist t
       JOIN (SELECT fonte, MAX(capturado_em) mx FROM medicamento_monitor_hist WHERE ean = ? GROUP BY fonte) g
         ON g.fonte = t.fonte AND g.mx = t.capturado_em
      WHERE t.ean = ? AND t.preco > 0 AND t.disponivel = 1`, [ean, ean]);
  let arr = snaps.map((s) => ({ preco: Number(s.preco), fonte: s.fonte }));
  if (arr.length < 2) {                                   // denso ainda não cobre → catálogo (sem sinal de estoque)
    const [cat] = await pool.query(
      `SELECT fonte, preco FROM catalogo_produto WHERE ean = ? AND preco > 0 AND moeda = 'BRL' AND fonte IN ${inFarmacias}`,
      [ean, ...FARMACIAS]);
    if (cat.length >= arr.length) arr = cat.map((r) => ({ preco: Number(r.preco), fonte: r.fonte }));
  }
  arr.sort((a, b) => a.preco - b.preco);
  return arr;
}
const medianaPreco = (arr) => { if (!arr.length) return null; const n = arr.length, k = Math.floor(n / 2); return n % 2 ? arr[k].preco : Math.round(((arr[k - 1].preco + arr[k].preco) / 2) * 100) / 100; };

// GET /sugestao?ean= → mediana de mercado (tabela, com estoque) p/ pré-preencher o baseline.
medicamentoRouter.get('/monitor-usuario/sugestao', requireAuth, async (req, res) => {
  try {
    const ean = eanLimpo(req.query.ean);
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    const arr = await precosMercado(getPool(), ean);
    res.json({ ean, mediana: medianaPreco(arr), menor: arr[0]?.preco ?? null, n_ofertas: arr.length });
  } catch (e) { console.error('[monitor-usuario/sugestao]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// POST /monitor-usuario {ean, baseline_declarado, baseline_origem} → cria/reativa (UNIQUE user×ean).
medicamentoRouter.post('/monitor-usuario', requireAuth, async (req, res) => {
  try {
    const ean = eanLimpo(req.body?.ean);
    const baseline = Number(req.body?.baseline_declarado);
    const origem = req.body?.baseline_origem === 'aceito_sugerido' ? 'aceito_sugerido' : 'declarado';
    if (!ean || !Number.isFinite(baseline) || baseline <= 0) return res.status(400).json({ erro: 'ean e baseline_declarado válidos obrigatórios' });
    const pool = getPool();
    const sugerido = medianaPreco(await precosMercado(pool, ean));
    await pool.query(
      `INSERT INTO usuario_monitor (utilizador, ean, baseline_declarado, baseline_sugerido, baseline_origem)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE baseline_declarado = VALUES(baseline_declarado), baseline_sugerido = VALUES(baseline_sugerido),
         baseline_origem = VALUES(baseline_origem), ativo = 1`,
      [req.user.id, ean, baseline, sugerido, origem]);
    const [[row]] = await pool.query('SELECT * FROM usuario_monitor WHERE utilizador = ? AND ean = ?', [req.user.id, ean]);
    res.status(201).json(row);
  } catch (e) { console.error('[monitor-usuario POST]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /meus-monitores → monitores ativos do usuário + preço atual de mercado + estado vs baseline.
medicamentoRouter.get('/meus-monitores', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM usuario_monitor WHERE utilizador = ? AND ativo = 1 ORDER BY criado_em DESC', [req.user.id]);
    const out = [];
    for (const m of rows) {
      const arr = await precosMercado(pool, m.ean);
      const atual = arr[0]?.preco ?? null;
      const baseline = Number(m.baseline_declarado);
      out.push({ ...m, preco_atual: atual, fonte_atual: arr[0]?.fonte ?? null,
        estado: atual == null ? 'sem_oferta' : atual <= baseline ? 'abaixo' : 'acima',
        desconto_pct: atual == null ? null : Math.round(((baseline - atual) / baseline) * 1000) / 10 });
    }
    res.json({ monitores: out });
  } catch (e) { console.error('[meus-monitores]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// PATCH /monitor-usuario/:id → edita baseline/limiar/piso/cooldown/exige_estoque (só do próprio).
medicamentoRouter.patch('/monitor-usuario/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const campos = {};
    for (const k of ['baseline_declarado', 'limiar_pct', 'piso_abs', 'cooldown_horas', 'exige_estoque']) {
      if (req.body?.[k] != null && Number.isFinite(Number(req.body[k]))) campos[k] = Number(req.body[k]);
    }
    if (!id || !Object.keys(campos).length) return res.status(400).json({ erro: 'nada a atualizar' });
    const sets = Object.keys(campos).map((k) => `${k} = ?`).join(', ');
    const pool = getPool();
    const [r] = await pool.query(`UPDATE usuario_monitor SET ${sets} WHERE id = ? AND utilizador = ?`, [...Object.values(campos), id, req.user.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'monitor não encontrado' });
    const [[row]] = await pool.query('SELECT * FROM usuario_monitor WHERE id = ?', [id]);
    res.json(row);
  } catch (e) { console.error('[monitor-usuario PATCH]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// DELETE /monitor-usuario/:id → soft-delete (ativo=0). Exclusão real fica p/ exclusão-de-conta (FK CASCADE).
medicamentoRouter.delete('/monitor-usuario/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [r] = await getPool().query('UPDATE usuario_monitor SET ativo = 0 WHERE id = ? AND utilizador = ?', [id, req.user.id]);
    if (!r.affectedRows) return res.status(404).json({ erro: 'monitor não encontrado' });
    res.json({ ok: true, id });
  } catch (e) { console.error('[monitor-usuario DELETE]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /meus-alertas → histórico de alerta_log do usuário (dry-run: entregue=0 até a entrega ligar).
medicamentoRouter.get('/meus-alertas', requireAuth, async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT a.*, m.produto FROM alerta_log a LEFT JOIN medicamento m ON m.ean = a.ean
        WHERE a.utilizador = ? ORDER BY a.disparado_em DESC LIMIT 200`, [req.user.id]);
    res.json({ alertas: rows });
  } catch (e) { console.error('[meus-alertas]', e); res.status(500).json({ erro: 'erro interno' }); }
});

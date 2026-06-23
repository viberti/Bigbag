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
    `SELECT fonte, preco, url, imagem_url, nome, scraped_at
       FROM catalogo_produto
      WHERE ean = ? AND moeda = 'BRL' AND preco > 0 AND fonte IN ${inFarmacias}
      ORDER BY preco ASC`,
    [ean, ...FARMACIAS],
  );
  return rows.map((r) => ({ ...r, preco: Number(r.preco) }));
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

// Equivalentes QUE TÊM oferta, com o menor preço e o preço por dose. O remédio `ean` de
// referência fica marcado. O preço/dose (R$ por comprimido / ml / g) SÓ é comparável entre
// embalagens EXATAMENTE da MESMA apresentação — mesmo princípio ativo + MESMA força + MESMA
// forma — diferindo só na QUANTIDADE. Por isso forma/dose têm de bater por IGUALDADE EXATA
// (não `<=>`, que casaria NULL com NULL e misturaria, ex., um xarope com um comprimido cuja
// forma não foi parseada). Se a referência não tem forma/dose, não há comparação possível.
async function equivalentesComOferta(pool, med) {
  if (med.forma == null || med.dose_valor == null || med.dose_unidade == null) return [];
  const [rows] = await pool.query(
    `SELECT m.ean, m.produto, m.laboratorio, m.tipo, m.generico, m.forma, m.qtd_embalagem, m.pmc_18,
            MIN(cp.preco) menor_preco, COUNT(DISTINCT cp.fonte) n_farmacias
       FROM medicamento m
       JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco > 0
        AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarmacias}
      WHERE m.substancia <=> ? AND m.dose_valor = ? AND m.dose_unidade = ? AND m.forma = ?
      GROUP BY m.ean
      ORDER BY (MIN(cp.preco) / NULLIF(m.qtd_embalagem, 0)) ASC, menor_preco ASC`,
    [...FARMACIAS, med.substancia, med.dose_valor, med.dose_unidade, med.forma],
  );
  return rows.map((r) => ({
    ean: r.ean, produto: r.produto, laboratorio: r.laboratorio, tipo: r.tipo,
    generico: !!r.generico, forma: r.forma, qtd_embalagem: r.qtd_embalagem,
    menor_preco: r.menor_preco == null ? null : Number(r.menor_preco),
    preco_por_dose: precoPorDose(r.menor_preco, r.qtd_embalagem),
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
    const melhor = ofertas[0] || null;
    const pmc = med.pmc_18 == null ? null : Number(med.pmc_18);
    const comparacao = melhor && pmc != null ? {
      pmc, melhor_preco: melhor.preco, melhor_fonte: melhor.fonte,
      economia_vs_pmc: Math.round((pmc - melhor.preco) * 100) / 100,
      pct_vs_pmc: pmc > 0 ? Math.round((1 - melhor.preco / pmc) * 1000) / 10 : null, // % abaixo do teto
    } : null;

    const equivalentes = await equivalentesComOferta(pool, med);
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
      ofertas, melhor, comparacao, equivalentes, mais_barato_equivalente: maisBaratoEquivalente,
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

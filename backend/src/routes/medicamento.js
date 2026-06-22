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

export const medicamentoRouter = Router();

// Farmácias online colhidas (fonte em catalogo_produto). Lê o MESMO manifesto que o
// harvester (fonte única) → acrescentar farmácia = editar o JSON + colher, sem mexer
// aqui. Mantém o foco em "farmácia": evita que um supermercado a vender um OTC entre
// como oferta.
const FARMACIAS = JSON.parse(readFileSync(new URL('../../scripts/fontes_farmacia.json', import.meta.url), 'utf8')).map((f) => f.fonte);
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
      WHERE ean = ? AND moeda = 'BRL' AND preco IS NOT NULL AND fonte IN ${inFarmacias}
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
async function escolherImagem(pool, med, eanConsultado, ph) {
  const reg = String(med.registro || '');
  const [rows] = await pool.query(
    `SELECT cp.ean, cp.imagem_url url FROM catalogo_produto cp JOIN medicamento m ON m.ean = cp.ean
      WHERE (cp.ean = ? OR (LENGTH(?) = 13 AND LEFT(m.registro, 9) = ? AND m.forma <=> ?))
        AND cp.imagem_url IS NOT NULL AND cp.imagem_url <> '' AND cp.fonte IN ${inFarmacias} LIMIT 150`,
    [eanConsultado, reg, reg.slice(0, 9), med.forma, ...FARMACIAS],
  );
  let best = null, bestScore = 0;
  for (const r of rows) {
    if (ehPlaceholder(r.url, ph)) continue;
    const fn = fnameImg(r.url);
    const own = String(r.ean) === String(eanConsultado);
    const temEan = fn.includes(String(r.ean));               // ficheiro nomeado pelo EAN → foto certa
    const descritivo = fn.replace(/[^a-z]/gi, '').length >= 6; // tem letras (não é só números genéricos)
    const s = own && temEan ? 5 : own ? 4 : temEan ? 3 : descritivo ? 1 : 0.2;
    if (s > bestScore) { bestScore = s; best = r.url; }
  }
  return best;
}

// Equivalentes terapêuticos (mesmo princípio ativo + força + forma) QUE TÊM oferta,
// com o menor preço e o preço por dose. O remédio `ean` de referência fica marcado.
async function equivalentesComOferta(pool, med) {
  const [rows] = await pool.query(
    `SELECT m.ean, m.produto, m.laboratorio, m.tipo, m.generico, m.qtd_embalagem, m.pmc_18,
            MIN(cp.preco) menor_preco, COUNT(DISTINCT cp.fonte) n_farmacias
       FROM medicamento m
       JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco IS NOT NULL
        AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarmacias}
      WHERE m.substancia <=> ? AND m.dose_valor <=> ? AND m.dose_unidade <=> ? AND m.forma <=> ?
      GROUP BY m.ean
      ORDER BY (MIN(cp.preco) / NULLIF(m.qtd_embalagem, 0)) ASC, menor_preco ASC`,
    [...FARMACIAS, med.substancia, med.dose_valor, med.dose_unidade, med.forma],
  );
  return rows.map((r) => ({
    ean: r.ean, produto: r.produto, laboratorio: r.laboratorio, tipo: r.tipo,
    generico: !!r.generico, qtd_embalagem: r.qtd_embalagem,
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
         JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco IS NOT NULL
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
    const resultados = [...marcas.values()]
      .map((m) => ({ ...m, n_apresentacoes: m.apresentacoes.length, apresentacoes: m.apresentacoes.sort((x, y) => (x.preco_por_dose ?? 9e9) - (y.preco_por_dose ?? 9e9)) }))
      .sort((a, b) => b.n_farmacias - a.n_farmacias || Number(a.menor_preco) - Number(b.menor_preco))
      .slice(0, 25);
    res.json({ q, resultados });
  } catch (e) { console.error('[medicamento/buscar]', e); res.status(500).json({ erro: 'erro interno' }); }
});

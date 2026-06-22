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
import { requireAuth } from '../auth.js';
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
medicamentoRouter.get('/info', requireAuth, async (req, res) => {
  try {
    const ean = eanLimpo(req.query.ean);
    if (!ean) return res.status(400).json({ erro: 'EAN inválido' });
    const pool = getPool();
    const [[med]] = await pool.query('SELECT * FROM medicamento WHERE ean = ?', [ean]);
    if (!med) return res.status(404).json({ erro: 'medicamento não encontrado na base CMED', ean });
    med.pmc_por_icms = parseJsonCol(med.pmc_por_icms);
    med.pf_por_icms = parseJsonCol(med.pf_por_icms);

    const ofertas = await ofertasDoEan(pool, ean);
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
        laboratorio: med.laboratorio, tipo: med.tipo, generico: !!med.generico, tarja: med.tarja,
        classe_terapeutica: med.classe_terapeutica, dosagem: med.dosagem, forma: med.forma,
        qtd_embalagem: med.qtd_embalagem, restricao_hospitalar: !!med.restricao_hospitalar,
        cmed_versao: med.cmed_versao,
      },
      tetos: { pf: med.pf == null ? null : Number(med.pf), pmc_18: pmc, pmc_por_icms: med.pmc_por_icms },
      ofertas, melhor, comparacao, equivalentes, mais_barato_equivalente: maisBaratoEquivalente,
    });
  } catch (e) { console.error('[medicamento/info]', e); res.status(500).json({ erro: 'erro interno' }); }
});

// GET /api/medicamento/equivalentes?ean=  → só a lista de equivalentes (genérico vs referência).
medicamentoRouter.get('/equivalentes', requireAuth, async (req, res) => {
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
medicamentoRouter.get('/buscar', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.json({ q, resultados: [] });
    const pool = getPool();
    // BOOLEAN: último token como prefixo (autocomplete).
    const toks = q.split(/\s+/).filter(Boolean);
    const expr = toks.map((t, i) => '+' + t.replace(/[+\-><()~*"@]/g, '') + (i === toks.length - 1 ? '*' : '')).join(' ');
    const [rows] = await pool.query(
      `SELECT m.ean, m.produto, m.substancia, m.laboratorio, m.generico, m.dosagem, m.forma, m.qtd_embalagem,
              MIN(cp.preco) menor_preco, COUNT(DISTINCT cp.fonte) n_farmacias
         FROM medicamento m
         JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco IS NOT NULL
          AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarmacias}
        WHERE MATCH(m.produto, m.substancia) AGAINST (? IN BOOLEAN MODE)
        GROUP BY m.ean
        ORDER BY n_farmacias DESC, menor_preco ASC
        LIMIT 40`,
      [...FARMACIAS, expr],
    );
    res.json({
      q, resultados: rows.map((r) => ({
        ean: r.ean, produto: r.produto, substancia: r.substancia, laboratorio: r.laboratorio,
        generico: !!r.generico, dosagem: r.dosagem, forma: r.forma,
        menor_preco: r.menor_preco == null ? null : Number(r.menor_preco),
        preco_por_dose: precoPorDose(r.menor_preco, r.qtd_embalagem), n_farmacias: r.n_farmacias,
      })),
    });
  } catch (e) { console.error('[medicamento/buscar]', e); res.status(500).json({ erro: 'erro interno' }); }
});

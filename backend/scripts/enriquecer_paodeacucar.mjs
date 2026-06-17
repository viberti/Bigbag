// ENRIQUECER Pão de Açúcar (GPA) — 2.º passo da PDP: tira da página de produto o que a
// API de busca NÃO traz: EAN, marca, INGREDIENTES e TABELA NUTRICIONAL (formatada).
//
// A PDP é Next.js: tudo vem no <script id="__NEXT_DATA__"> em props.pageProps.product:
//   { ean, brand, description, nutritionalMap{attributes[{code,label,value,vd}]},
//     attributeGroups[ general_characteristic{ingredientes,…}, additional_information(alergénios) ] }
// O `value` da tabela é POR 100 g (confirmado pelo cruzamento com o %VD da porção) → entra
// direto na shape padrão {sal,fibra,gordura,acucares,hidratos,proteina,energia_kcal,gordura_saturada}.
//
// Endpoint LEVE: /_next/data/<buildId>/produto/<id>/<slug>.json (~168 KB, metade do HTML).
// buildId resolve-se 1× e re-resolve-se se rodar (deploy do site); HTML é o fallback à prova de bala.
//
// Idempotente/retomável: processa fonte='paodeacucar' AND ean IS NULL, mais antigos primeiro
// (scraped_at ASC); cada linha tocada leva scraped_at=NOW() → rotaciona, sem ciclo apertado.
//   sudo -u dev node --env-file=.env scripts/enriquecer_paodeacucar.mjs [--limite N] [--delay ms]
import { getPool, closePool } from '../src/db.js';
import { eanValido } from '../src/normaliza/ean.js';

const FONTE = 'paodeacucar';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LIMITE = Number(arg('--limite', '300'));
const DELAY = Number(arg('--delay', '150'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let buildId = null;
async function fetchTexto(url, accept) {
  for (let t = 0; ; t++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(22000) });
      if ((r.status === 429 || r.status >= 500) && t < 3) { await sleep(1200 * (t + 1)); continue; }
      return { status: r.status, text: r.ok ? await r.text() : '' };
    } catch (e) { if (t >= 3) return { status: 0, text: '' }; await sleep(900 * (t + 1)); }
  }
}
function nextDataDoHtml(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
async function resolverBuildId() {
  const { text } = await fetchTexto('https://www.paodeacucar.com/produto/1637429/biscoito-look-original-goiabinha-80g', 'text/html');
  buildId = nextDataDoHtml(text)?.buildId || null;
  return buildId;
}
// devolve o objeto product da PDP (endpoint leve; fallback ao HTML)
async function obterProduto(url) {
  const mm = url.match(/\/produto\/(\d+)\/(.+)$/);
  if (!mm) return null;
  const [, id, slug] = mm;
  if (buildId) {
    const dataUrl = `https://www.paodeacucar.com/_next/data/${buildId}/produto/${id}/${encodeURIComponent(slug)}.json?id=${id}&slug=${encodeURIComponent(slug)}`;
    const r = await fetchTexto(dataUrl, 'application/json');
    if (r.status === 200) { try { return JSON.parse(r.text)?.pageProps?.product || null; } catch { /* cai p/ HTML */ } }
    if (r.status === 404) await resolverBuildId(); // buildId rodou → re-resolve e cai p/ HTML desta vez
  }
  const h = await fetchTexto(url, 'text/html');
  return nextDataDoHtml(h.text)?.props?.pageProps?.product || null;
}

const num = (s) => { if (s == null) return null; const m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
function extrair(p) {
  if (!p) return null;
  const eanCru = String(p.ean || '').replace(/\D/g, '');
  const ean = eanValido(eanCru) ? eanCru : null;
  const marca = (p.brand || '').trim() || null;
  const grupos = p.attributeGroups || [];
  const attrVal = (gc, ac) => grupos.find((g) => g.code === gc)?.attributes?.find((a) => a.code === ac)?.value || null;
  const ingredientes = String(attrVal('general_characteristic', 'ingredientes') || '').replace(/\s+/g, ' ').trim() || null;
  let nutricao = null;
  const at = p.nutritionalMap?.attributes;
  if (Array.isArray(at) && at.length) {
    const v = (code) => num(at.find((x) => x.code === code)?.value);
    const sodioMg = v('infnutricSodio');
    const n = {
      sal: sodioMg != null ? Math.round(sodioMg * 2.5) / 1000 : null, // sódio(mg) → sal(g)
      fibra: v('infnutricFibraAlim'),
      gordura: v('infnutricGordurasTotais'),
      acucares: v('infnutricAcucaresTotais'),
      hidratos: v('infnutricCarboidrato'),
      proteina: v('infnutricProteina'),
      energia_kcal: v('infnutricValorEnergetico'),
      gordura_saturada: v('infnutricGordurasSaturadas'),
    };
    if (Object.values(n).some((x) => x != null)) nutricao = n;
  }
  return { ean, marca, ingredientes, nutricao, eanCru };
}

async function main() {
  const pool = getPool();
  await resolverBuildId();
  console.log(`buildId: ${buildId || '(falhou — só HTML)'} · limite ${LIMITE} · delay ${DELAY}ms`);
  const [linhas] = await pool.query(
    `SELECT id, url FROM catalogo_produto WHERE fonte = ? AND ean IS NULL AND url IS NOT NULL
     ORDER BY scraped_at ASC, id ASC LIMIT ?`, [FONTE, LIMITE]);
  console.log(`a processar ${linhas.length} produtos…`);
  let ok = 0; let cEan = 0; let cNut = 0; let cIng = 0; let semEan = 0; let falhas = 0;
  for (let i = 0; i < linhas.length; i++) {
    const { id, url } = linhas[i];
    const p = await obterProduto(url).catch(() => null);
    if (!p) { falhas++; await sleep(DELAY); continue; }
    const e = extrair(p);
    if (e.ean) cEan++; else { semEan++; if (e.eanCru) console.error(`  ean inválido (${e.eanCru}) em ${url}`); }
    if (e.nutricao) cNut++;
    if (e.ingredientes) cIng++;
    // só escreve campos que vieram (COALESCE preserva o que já houver de melhor não-nulo)
    await pool.query(
      `UPDATE catalogo_produto SET
         ean = COALESCE(?, ean),
         marca = COALESCE(?, marca),
         ingredientes = COALESCE(?, ingredientes),
         nutricao = COALESCE(CAST(? AS JSON), nutricao),
         nutricao_base = CASE WHEN ? IS NOT NULL THEN '100g' ELSE nutricao_base END,
         scraped_at = NOW()
       WHERE id = ?`,
      [e.ean, e.marca, e.ingredientes, e.nutricao ? JSON.stringify(e.nutricao) : null, e.nutricao ? 1 : null, id],
    );
    ok++;
    if ((i + 1) % 50 === 0) process.stderr.write(`\r  ${i + 1}/${linhas.length} · ean ${cEan} · nutri ${cNut} · ingred ${cIng} · falhas ${falhas}   `);
    await sleep(DELAY);
  }
  process.stderr.write('\n');
  console.log(`✅ processados ${ok} | com EAN ${cEan} (sem/ inválido ${semEan}) | com nutrição ${cNut} | com ingredientes ${cIng} | falhas de fetch ${falhas}`);
  const [[g]] = await pool.query(
    `SELECT COUNT(*) n, SUM(ean IS NOT NULL) ean, SUM(nutricao IS NOT NULL) nut, SUM(ingredientes IS NOT NULL) ing
     FROM catalogo_produto WHERE fonte = ?`, [FONTE]);
  console.log(`paodeacucar agora: ${g.n} linhas | ${g.ean} c/ EAN | ${g.nut} c/ nutrição | ${g.ing} c/ ingredientes`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

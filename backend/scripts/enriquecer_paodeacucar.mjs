// ENRIQUECER Pão de Açúcar (GPA) — 2.º passo da PDP: tira da página de produto o que a
// API de busca NÃO traz: EAN, marca, INGREDIENTES e TABELA NUTRICIONAL (formatada).
//
// A PDP é Next.js: tudo vem no <script id="__NEXT_DATA__"> em props.pageProps.product:
//   { ean, brand, description, nutritionalMap{header,attributes[{code,label,value,vd}]},
//     attributeGroups[ general_characteristic{ingredientes,…}, additional_information(alergénios) ] }
//
// BASE DA NUTRIÇÃO É INCONSISTENTE NA FONTE: o `value` às vezes é por 100 g (rótulo ANVISA
// novo), às vezes por PORÇÃO (rótulo antigo) — sem flag. Normalizamos SEMPRE para 100 g
// detetando a base com o `%VD` (que é SEMPRE por porção): para cada nutriente com VD conhecido,
// per_porção = vd% × VD_ref; comparamos `value` com per_porção vs per_100g (=per_porção×100/porção)
// e VOTAMOS. Maioria por-porção → escala ×100/porção. (Confirma: BelVita 113 kcal/porção 25g → 452/100g.)
//
// Endpoint LEVE: /_next/data/<buildId>/produto/<id>/<slug>.json (~168 KB, metade do HTML).
// buildId resolve-se 1× e re-resolve-se se rodar (deploy do site); HTML é o fallback à prova de bala.
//
// Idempotente/retomável via `pdp_em` (migração 069): processa fonte='paodeacucar' AND pdp_em IS NULL;
// cada PDP visitada (mesmo sem nutrição) leva pdp_em=NOW() → nunca re-raspa o que não tem tabela.
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
    } catch { if (t >= 3) return { status: 0, text: '' }; await sleep(900 * (t + 1)); }
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
// porção em gramas/ml do cabeçalho ("Porção de 30G - 3 unidades", "Porção de 200 ml")
function porcaoG(header) {
  const m = String(header || '').match(/porç[ãa]o\s*de\s*([\d.,]+)\s*(kg|g|ml|l)\b/i);
  if (!m) return null;
  const v = num(m[1]); if (v == null) return null;
  const u = m[2].toLowerCase();
  return (u === 'kg' || u === 'l') ? v * 1000 : v;
}
// VD de referência ANVISA (validado por cruzamento com produtos por-100g conhecidos)
const VD_REF = {
  infnutricValorEnergetico: 2000, infnutricCarboidrato: 300, infnutricProteina: 50,
  infnutricGordurasTotais: 65, infnutricGordurasSaturadas: 20, infnutricFibraAlim: 25, infnutricSodio: 2000,
};
// fator para passar `value` → por 100 g. Vota por nutriente: o `value` está mais perto do
// esperado por-porção (vd×ref) ou do esperado por-100g (=por-porção×100/porção)?
function fatorPara100g(at, pG) {
  if (!pG) return 1; // sem porção não dá p/ aferir → assume por 100 g (o caso comum do rótulo novo)
  let vPorcao = 0; let v100 = 0;
  for (const [code, ref] of Object.entries(VD_REF)) {
    const a = at.find((x) => x.code === code); if (!a) continue;
    const val = num(a.value); const vd = num(a.vd);
    if (val == null || val <= 0 || vd == null || vd <= 0) continue;
    const perPorcao = (vd / 100) * ref; if (perPorcao <= 0) continue;
    const per100 = perPorcao * 100 / pG;
    const dP = Math.abs(Math.log(val / perPorcao));
    const d100 = Math.abs(Math.log(val / per100));
    if (Math.abs(dP - d100) < 0.25) continue; // porção≈100g (ambíguo) → não vota
    if (dP < d100) vPorcao++; else v100++;
  }
  return vPorcao > v100 ? 100 / pG : 1;
}

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
    const f = fatorPara100g(at, porcaoG(p.nutritionalMap.header));
    const escala = (code) => { const v = num(at.find((x) => x.code === code)?.value); return v == null ? null : Math.round(v * f * 1000) / 1000; };
    const sodioMg = escala('infnutricSodio');
    const n = {
      sal: sodioMg != null ? Math.round(sodioMg * 2.5) / 1000 : null, // sódio(mg) → sal(g)
      fibra: escala('infnutricFibraAlim'),
      gordura: escala('infnutricGordurasTotais'),
      acucares: escala('infnutricAcucaresTotais'),
      hidratos: escala('infnutricCarboidrato'),
      proteina: escala('infnutricProteina'),
      energia_kcal: escala('infnutricValorEnergetico'),
      gordura_saturada: escala('infnutricGordurasSaturadas'),
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
    `SELECT id, url FROM catalogo_produto WHERE fonte = ? AND pdp_em IS NULL AND url IS NOT NULL
     ORDER BY id ASC LIMIT ?`, [FONTE, LIMITE]);
  console.log(`a processar ${linhas.length} produtos…`);
  let ok = 0; let cEan = 0; let cNut = 0; let cIng = 0; let semEan = 0; let falhas = 0;
  for (let i = 0; i < linhas.length; i++) {
    const { id, url } = linhas[i];
    const p = await obterProduto(url).catch(() => null);
    if (!p) { falhas++; await sleep(DELAY); continue; } // não marca pdp_em → tenta de novo numa próxima corrida
    const e = extrair(p);
    if (e.ean) cEan++; else if (e.eanCru) semEan++;
    if (e.nutricao) cNut++;
    if (e.ingredientes) cIng++;
    // PDP é autoritativa → sobrescreve nutrição/ingredientes/marca quando vêm; EAN só preenche
    // (COALESCE) p/ nunca perder um já existente. pdp_em=NOW() marca a visita (idempotência).
    await pool.query(
      `UPDATE catalogo_produto SET
         ean = COALESCE(?, ean),
         marca = COALESCE(?, marca),
         ingredientes = CASE WHEN ? IS NOT NULL THEN ? ELSE ingredientes END,
         nutricao = CASE WHEN ? IS NOT NULL THEN CAST(? AS JSON) ELSE nutricao END,
         nutricao_base = CASE WHEN ? IS NOT NULL THEN '100g' ELSE nutricao_base END,
         pdp_em = NOW()
       WHERE id = ?`,
      [e.ean, e.marca, e.ingredientes, e.ingredientes,
        e.nutricao ? JSON.stringify(e.nutricao) : null, e.nutricao ? JSON.stringify(e.nutricao) : null,
        e.nutricao ? 1 : null, id],
    );
    ok++;
    if ((i + 1) % 50 === 0) process.stderr.write(`\r  ${i + 1}/${linhas.length} · ean ${cEan} · nutri ${cNut} · ingred ${cIng} · falhas ${falhas}   `);
    await sleep(DELAY);
  }
  process.stderr.write('\n');
  console.log(`✅ visitados ${ok} | com EAN ${cEan} (sem/inválido ${semEan}) | com nutrição ${cNut} | com ingredientes ${cIng} | falhas de fetch ${falhas}`);
  const [[g]] = await pool.query(
    `SELECT COUNT(*) n, SUM(pdp_em IS NOT NULL) visit, SUM(ean IS NOT NULL) ean, SUM(nutricao IS NOT NULL) nut, SUM(ingredientes IS NOT NULL) ing
     FROM catalogo_produto WHERE fonte = ?`, [FONTE]);
  console.log(`paodeacucar: ${g.n} linhas | ${g.visit} PDP visitadas | ${g.ean} c/ EAN | ${g.nut} c/ nutrição | ${g.ing} c/ ingredientes`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

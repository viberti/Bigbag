// Importa o DUMP do Open Food Facts → tabela local `off_produto` (migração 038).
// Streaming (curl | gunzip | readline) — nunca grava os ~10 GB em disco.
// Filtro: produtos com countries=Portugal OU marca própria/insígnia dos nossos
// mercados (Lidl 18,5k, Aldi, Mercadona/Hacendado, Continente, PD, Auchan…) —
// a chave de cruzamento é o EAN, igual em toda a Europa, por isso o sortido
// estrangeiro dos discounters serve-nos na mesma.
//
// Uso:  node scripts/importar_off.mjs            ← dump completo (~1-2 h)
//       TESTE=200000 node scripts/importar_off.mjs  ← só as primeiras N linhas
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { getPool } from '../src/db.js';

const DUMP = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';
const TESTE = Number(process.env.TESTE || 0);

// tags de marca que nos interessam (inclui sub-marcas próprias dos 6 mercados)
const MARCAS = new Set([
  'lidl', 'milbona', 'pilos', 'crownfield', 'combino', 'freeway', 'cien', 'lupilu', 'parkside',
  'deluxe', 'chef-select', 'alesto', 'vemondo', 'sondey', 'tower-isle', 'dulano', 'baresa', 'cimarosa',
  'aldi', 'aldi-nord', 'aldi-sud', 'milsani', 'moser-roth', 'biocura', 'tandil', 'gut-bio', 'milfina',
  'mercadona', 'hacendado', 'deliplus', 'bosque-verde', 'compy',
  'continente', 'continente-equilibrio', 'continente-seleccao', 'mythos',
  'pingo-doce', 'auchan', 'polegar', 'makro', 'aro',
  // Intermarché (site = DataDome, mas as marcas próprias francesas estão muito bem no OFF)
  'intermarche', 'paturages', 'chabrior', 'monique-ranou', 'saint-eloi', 'capitaine-cook',
  'top-budget', 'itineraire-des-saveurs', 'fiorini', 'apta', 'elodie', 'pommette',
]);
// pré-filtro barato (evita JSON.parse de 4M de linhas): UMA regex compilada com
// alternação — toLowerCase+50×includes por linha punha o processo a 100% de CPU
// durante horas no host partilhado. 'portugal' sem aspas (no dump vem
// "en:portugal"/"France,Portugal"); marcas como tags exatas, com aspas.
const RE_AGULHAS = new RegExp(`portugal|${[...MARCAS].map((m) => `"${m}"`).join('|')}`, 'i');

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const corta = (s, n) => (s ? String(s).slice(0, n) : null);

async function main() {
  const pool = getPool();
  console.log('[off] a descarregar+processar o dump em streaming…');
  // --limit-rate: host partilhado (pitacos.ai/1417) — não saturar a banda
  const curl = spawn('curl', ['-sL', '--retry', '3', '--limit-rate', '3M', DUMP], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: curl.stdout.pipe(createGunzip()), crlfDelay: Infinity });

  let linhas = 0, aceites = 0, erros = 0;
  const t0 = Date.now();
  for await (const linha of rl) {
    linhas++;
    if (TESTE && linhas > TESTE) break;
    if (linhas % 500000 === 0) console.log(`  …${(linhas / 1e6).toFixed(1)}M linhas, ${aceites} aceites (${Math.round((Date.now() - t0) / 1000)}s)`);
    // pré-filtro textual barato; só depois JSON.parse
    if (!RE_AGULHAS.test(linha)) continue;
    let p;
    try { p = JSON.parse(linha); } catch { continue; }
    const ean = String(p.code || '').replace(/\D/g, '');
    if (ean.length < 8) continue;
    const paises = (p.countries_tags || []).map((t) => String(t).replace('en:', ''));
    const marcas = (p.brands_tags || []).map(String);
    const queremos = paises.includes('portugal') || marcas.some((m) => MARCAS.has(m));
    if (!queremos) continue;
    const n = p.nutriments || {};
    const nutricao = {
      energia_kcal: num(n['energy-kcal_100g']), gordura: num(n.fat_100g), gordura_saturada: num(n['saturated-fat_100g']),
      hidratos: num(n.carbohydrates_100g), acucares: num(n.sugars_100g), proteina: num(n.proteins_100g),
      sal: num(n.salt_100g), fibra: num(n.fiber_100g),
    };
    const temNutricao = Object.values(nutricao).some((v) => v != null);
    try {
      await pool.query(
        `INSERT INTO off_produto (ean, nome, nome_pt, marca, quantidade, categoria, categorias_tags, grupos_alimento,
           labels, nutriscore, nova, alergenios, ingredientes, nutricao, paises)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE nome=VALUES(nome), nome_pt=VALUES(nome_pt), marca=VALUES(marca),
           quantidade=VALUES(quantidade), categoria=VALUES(categoria), categorias_tags=VALUES(categorias_tags),
           grupos_alimento=VALUES(grupos_alimento), labels=VALUES(labels), nutriscore=VALUES(nutriscore),
           nova=VALUES(nova), alergenios=VALUES(alergenios), ingredientes=VALUES(ingredientes),
           nutricao=VALUES(nutricao), paises=VALUES(paises), importado_em=NOW()`,
        [ean, corta(p.product_name, 255), corta(p.product_name_pt, 255), corta(p.brands, 160), corta(p.quantity, 60),
          corta(p.categories, 255), p.categories_tags ? JSON.stringify(p.categories_tags.slice(0, 30)) : null,
          p.food_groups_tags ? JSON.stringify(p.food_groups_tags) : null,
          p.labels_tags ? JSON.stringify(p.labels_tags.slice(0, 20)) : null,
          /^[a-e]$/i.test(p.nutriscore_grade || '') ? p.nutriscore_grade.toUpperCase() : null,
          num(p.nova_group), corta(p.allergens, 255), corta(p.ingredients_text_pt || p.ingredients_text, 60000),
          temNutricao ? JSON.stringify(nutricao) : null, corta(paises.join(','), 255)],
      );
      aceites++;
    } catch (e) { erros++; if (erros <= 5) console.error('  erro:', ean, e.message); }
  }
  curl.kill('SIGTERM');
  console.log(`\n✅ [off] ${linhas} linhas lidas → ${aceites} produtos importados, ${erros} erros (${Math.round((Date.now() - t0) / 60000)} min).`);
  const [[c]] = await pool.query("SELECT COUNT(*) n, SUM(paises LIKE '%portugal%') pt, SUM(nutricao IS NOT NULL) com_nutricao FROM off_produto");
  console.log(`[off] na tabela: ${c.n} (${c.pt} c/ Portugal, ${c.com_nutricao} c/ nutrição).`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

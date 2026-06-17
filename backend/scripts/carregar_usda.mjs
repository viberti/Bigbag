// Carrega data/usda.json (USDA SR Legacy) em nutricao_usda. Traduz os nomes EN->PT com o LLM
// (lotes; ~$0,2) e materializa o `busca`. Idempotente (TRUNCATE + insert).
//   sudo -u dev node --env-file=.env scripts/carregar_usda.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from '../src/db.js';
import { tokensTaco } from '../src/normaliza/taco.js';
import { chatCompletion } from '../src/openrouter.js';
import { parseJsonLoose } from '../src/ingest/extract.js';
import { config } from '../src/config.js';

const FICHEIRO = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'usda.json');

const PROMPT = `Recebes uma lista NUMERADA de nomes de alimentos da base USDA em INGLÊS (genéricos: carnes, vegetais, frutas, laticínios, cereais, óleos, doces, temperos, bebidas, sopas…). Devolve o NOME COMUM GENÉRICO em PORTUGUÊS DO BRASIL de cada um, na MESMA ORDEM.
- O formato é "Alimento, descritor, descritor…". TRADUZ o alimento e MANTÉM só os descritores que distinguem a família (ex.: "Cheese, gorgonzola"→"Queijo Gorgonzola"; "Beef, ground, raw"→"Carne Moída"; "Oil, olive"→"Azeite de Oliva"; "Milk, whole"→"Leite Integral"; "Rice, white, long-grain, raw"→"Arroz Branco").
- TIRA descritores técnicos: "raw", "cooked", "n.s.", percentagens, "with salt added in cooking", marcas.
- Nome curto, comum no Brasil. Sem marca. Capitalização normal.
Devolve SÓ {"r":["<nome PT 1>","<nome PT 2>", …]} com EXATAMENTE o mesmo número de nomes da lista, pela ordem.`;

function extrair(content) {
  let obj;
  try { obj = JSON.parse(content); } catch { try { obj = parseJsonLoose(content); } catch { return null; } }
  const r = obj?.r ?? (Array.isArray(obj) ? obj : null);
  return Array.isArray(r) ? r.map((x) => (x == null ? '' : String(x).trim())) : null;
}

async function traduzir(nomes) {
  const pt = new Array(nomes.length).fill(null);
  for (let i = 0; i < nomes.length; i += 50) {
    const lote = nomes.slice(i, i + 50);
    const user = lote.map((en, k) => `${k + 1}. ${en}`).join('\n');
    let r = null;
    for (let tent = 0; tent < 2 && !r; tent++) {
      try {
        const content = await chatCompletion({
          messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: user }],
          model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, contexto: 'traducao',
        });
        const cand = extrair(content);
        if (cand && cand.length === lote.length) r = cand;
      } catch { /* retry */ }
    }
    if (r) for (let k = 0; k < lote.length; k++) pt[i + k] = r[k] || null;
    else console.warn(`  lote ${i}-${i + lote.length} sem tradução (fica EN)`);
    if ((i / 50) % 20 === 0) console.log(`  …${Math.min(i + 50, nomes.length)}/${nomes.length}`);
  }
  return pt;
}

async function main() {
  const dados = JSON.parse(await readFile(FICHEIRO, 'utf8'));
  console.log(`[usda] ${dados.length} registos. A traduzir nomes EN->PT (pode demorar ~5 min)…`);
  const pt = await traduzir(dados.map((d) => d.nome_en));
  const vals = [];
  let semPt = 0;
  for (let i = 0; i < dados.length; i++) {
    const nome = pt[i] || dados[i].nome_en;
    if (!pt[i]) semPt++;
    const busca = tokensTaco(nome).join(' ').slice(0, 255);
    if (!busca) continue;
    vals.push(['usda', nome.slice(0, 255), String(dados[i].nome_en).slice(0, 255),
      JSON.stringify(dados[i].nut), busca]);
  }
  const pool = getPool();
  await pool.query('TRUNCATE nutricao_usda');
  for (let i = 0; i < vals.length; i += 300) {
    await pool.query(
      'INSERT INTO nutricao_usda (fonte, descricao, nome_en, nutricao, busca) VALUES '
        + vals.slice(i, i + 300).map(() => '(?,?,?,?,?)').join(','),
      vals.slice(i, i + 300).flat());
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n FROM nutricao_usda');
  console.log(`✅ USDA: ${c.n} alimentos carregados; ${semPt} sem tradução (ficaram EN).`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

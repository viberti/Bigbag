// Carrega data/fao.json (uFiSh+uPulses) em nutricao_fao. Traduz os nomes EN->PT com o LLM
// (1 lote; ~$0,01) e materializa o `busca`. Idempotente (TRUNCATE + insert).
//   sudo -u dev node --env-file=.env scripts/carregar_fao.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from '../src/db.js';
import { tokensTaco } from '../src/normaliza/taco.js';
import { chatCompletion } from '../src/openrouter.js';
import { parseJsonLoose } from '../src/ingest/extract.js';

const FICHEIRO = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'fao.json');

const PROMPT = `Recebes nomes de alimentos da base FAO/INFOODS em INGLÊS (peixes e leguminosas). Devolve o NOME COMUM GENÉRICO em PORTUGUÊS DO BRASIL de cada um, como apareceria num produto/receita.
- TIRA descritores: "raw", "fillet", "whole", "mature", "dried", "split", "w/o skin", "(n.s.)", "(ASEAN)", "fresh".
- MANTÉM a espécie/variedade que distingue (ex.: pinto bean→"Feijão Carioca"; adzuki bean→"Feijão Azuki"; kidney bean→"Feijão Vermelho"; chickpea→"Grão-de-bico"; lentil→"Lentilha"; cowpea→"Feijão Fradinho"; skipjack tuna→"Atum"; Nile tilapia→"Tilápia"; hake→"Pescada"; sardine→"Sardinha").
- Nome curto, comum no Brasil. Sem marca. Capitalização normal.
Recebes um array JSON de {i, en}. Devolve SÓ {"r":[{"i":<i>,"pt":"<nome PT>"}, …]} com TODOS os i.`;

async function traduzir(nomes) {
  const pt = new Array(nomes.length);
  for (let i = 0; i < nomes.length; i += 50) {
    const lote = nomes.slice(i, i + 50).map((en, k) => ({ i: i + k, en }));
    const content = await chatCompletion({
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify(lote) }],
      responseFormat: { type: 'json_object' }, contexto: 'traducao',
    });
    const obj = parseJsonLoose(content);
    for (const r of (obj?.r || [])) if (Number.isInteger(r.i) && r.pt) pt[r.i] = String(r.pt).trim();
  }
  return pt;
}

async function main() {
  const dados = JSON.parse(await readFile(FICHEIRO, 'utf8'));
  console.log(`[fao] ${dados.length} registos. A traduzir nomes EN->PT…`);
  const pt = await traduzir(dados.map((d) => d.nome_en));
  const vals = [];
  let semPt = 0;
  for (let i = 0; i < dados.length; i++) {
    const nome = pt[i] || dados[i].nome_en; // fallback ao EN se a tradução falhar (não perde a ficha)
    if (!pt[i]) semPt++;
    const busca = tokensTaco(nome).join(' ').slice(0, 255);
    if (!busca) continue; // sem tokens úteis → não é indexável
    vals.push([dados[i].fonte.slice(0, 16), nome.slice(0, 255), String(dados[i].nome_en).slice(0, 255),
      JSON.stringify(dados[i].nut), busca]);
  }
  const pool = getPool();
  await pool.query('TRUNCATE nutricao_fao');
  for (let i = 0; i < vals.length; i += 200) {
    await pool.query(
      'INSERT INTO nutricao_fao (fonte, descricao, nome_en, nutricao, busca) VALUES '
        + vals.slice(i, i + 200).map(() => '(?,?,?,?,?)').join(','),
      vals.slice(i, i + 200).flat());
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(DISTINCT fonte) f FROM nutricao_fao');
  console.log(`✅ FAO: ${c.n} alimentos carregados (${c.f} fontes); ${semPt} sem tradução (ficaram EN).`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

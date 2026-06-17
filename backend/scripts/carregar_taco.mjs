// Carrega a TACO (backend/data/taco.json) em nutricao_taco. Idempotente (TRUNCATE + insert).
//   sudo -u dev node --env-file=.env scripts/carregar_taco.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from '../src/db.js';
import { tokensTaco } from '../src/normaliza/taco.js';

const FICHEIRO = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'taco.json');

// um alimento com TODOS os macros 0/null é um BURACO do dump (ex.: "Leite, de vaca, integral" a 0 kcal),
// não um zero real — exclui-se para não servir nutrição falsa (o chamador cai na estimativa do LLM).
const buraco = (n) => [n.energia_kcal, n.proteina, n.gordura, n.hidratos].every((v) => v === 0 || v == null);

async function main() {
  const todos = JSON.parse(await readFile(FICHEIRO, 'utf8'));
  const dados = todos.filter((a) => !buraco(a.nut));
  const pool = getPool();
  await pool.query('TRUNCATE nutricao_taco');
  const vals = dados.map((a) => [a.id, String(a.descricao).slice(0, 255), a.categoria ? String(a.categoria).slice(0, 80) : null,
    JSON.stringify(a.nut), tokensTaco(a.descricao).join(' ').slice(0, 255)]);
  for (let i = 0; i < vals.length; i += 200) {
    await pool.query(
      'INSERT INTO nutricao_taco (id, descricao, categoria, nutricao, busca) VALUES '
        + vals.slice(i, i + 200).map(() => '(?,?,?,?,?)').join(','),
      vals.slice(i, i + 200).flat());
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(DISTINCT categoria) cats FROM nutricao_taco');
  console.log(`✅ TACO: ${c.n} alimentos carregados (${c.cats} categorias); ${todos.length - dados.length} buracos excluídos.`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

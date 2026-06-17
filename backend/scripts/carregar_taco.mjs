// Carrega a TACO (backend/data/taco.json) em nutricao_taco. Idempotente (TRUNCATE + insert).
//   sudo -u dev node --env-file=.env scripts/carregar_taco.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from '../src/db.js';
import { tokensTaco } from '../src/normaliza/taco.js';

const FICHEIRO = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'taco.json');

async function main() {
  const dados = JSON.parse(await readFile(FICHEIRO, 'utf8'));
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
  console.log(`✅ TACO: ${c.n} alimentos carregados (${c.cats} categorias).`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

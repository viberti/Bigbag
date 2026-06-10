// Uniformiza a CAPITALIZAÇÃO de nome/marca no banco de EANs (produto_ean +
// catalogo_produto): ALLCAPS/minúsculas → Título PT (tituloProduto). NÃO toca em
// produto_nome (variantes de matching), item.descricao_original nem sku_alias —
// esses ficam verbatim como vêm dos mercados. Idempotente.
//   node scripts/uniformizar_nomes.mjs [--dry]
import { getPool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const dry = process.argv.includes('--dry');

async function uniformizar(pool, tabela) {
  const [rows] = await pool.query(`SELECT id, nome, marca FROM ${tabela}`);
  let n = 0;
  const exemplos = [];
  for (const r of rows) {
    const nome = r.nome == null ? null : tituloProduto(r.nome);
    const marca = r.marca == null ? null : tituloProduto(r.marca);
    if (nome === r.nome && marca === r.marca) continue;
    n++;
    if (exemplos.length < 5) exemplos.push(`${r.nome ?? ''} → ${nome ?? ''}${r.marca !== marca ? `  [${r.marca} → ${marca}]` : ''}`);
    if (!dry) await pool.query(`UPDATE ${tabela} SET nome = ?, marca = ? WHERE id = ?`, [nome, marca, r.id]);
  }
  console.log(`${tabela}: ${n}/${rows.length} linha(s) ${dry ? 'a alterar (dry-run)' : 'uniformizadas'}`);
  for (const e of exemplos) console.log('   ', e);
}

const pool = getPool();
await uniformizar(pool, 'produto_ean');
await uniformizar(pool, 'catalogo_produto');
await pool.end();

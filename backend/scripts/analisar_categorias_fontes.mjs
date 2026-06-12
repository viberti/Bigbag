// EXPLORAÇÃO (2026-06-13): o que as fontes de catálogo oferecem de CATEGORIA —
// cobertura por fonte, profundidade da hierarquia, formato do separador — e
// simulação do voto-por-vizinhança (classificar produto SEM EAN pela moda das
// categorias dos produtos de nome semelhante). Suporta a estratégia de
// classificação proposta pelo dono. Só leitura.
//   sudo -u dev node --env-file=.env scripts/analisar_categorias_fontes.mjs ["nome a testar"]
import { getPool } from '../src/db.js';
import { norm } from '../src/normaliza/categoria.js';

const pool = getPool();

// 1) cobertura por fonte
const [porFonte] = await pool.query(`
  SELECT fonte, COUNT(*) total,
         SUM(CASE WHEN COALESCE(NULLIF(categoria_path,''), NULLIF(categoria,'')) IS NOT NULL THEN 1 ELSE 0 END) com_cat,
         SUM(CASE WHEN ean IS NOT NULL AND ean <> '' THEN 1 ELSE 0 END) com_ean
  FROM catalogo_produto GROUP BY fonte ORDER BY total DESC`);
console.log('— Cobertura por fonte (catalogo_produto):');
for (const r of porFonte) {
  console.log(`  ${String(r.fonte).padEnd(14)} total=${String(r.total).padStart(6)}  c/categoria=${String(r.com_cat).padStart(6)} (${Math.round((100 * r.com_cat) / r.total)}%)  c/EAN=${r.com_ean}`);
}

// 2) formato + profundidade por fonte (1 exemplo + distribuição de níveis)
console.log('\n— Formato e profundidade (separadores / > |):');
for (const r of porFonte) {
  const [[ex]] = await pool.query(
    `SELECT COALESCE(NULLIF(categoria_path,''), categoria) AS cat FROM catalogo_produto
     WHERE fonte = ? AND COALESCE(NULLIF(categoria_path,''), NULLIF(categoria,'')) IS NOT NULL LIMIT 1`, [r.fonte]);
  if (!ex) { console.log(`  ${r.fonte}: (sem categoria)`); continue; }
  const sep = ex.cat.includes('/') ? '/' : ex.cat.includes('>') ? '>' : ex.cat.includes('|') ? '|' : null;
  const [niveis] = await pool.query(
    `SELECT LENGTH(COALESCE(NULLIF(categoria_path,''), categoria)) -
            LENGTH(REPLACE(COALESCE(NULLIF(categoria_path,''), categoria), ?, '')) AS seps, COUNT(*) n
     FROM catalogo_produto WHERE fonte = ? AND COALESCE(NULLIF(categoria_path,''), NULLIF(categoria,'')) IS NOT NULL
     GROUP BY seps ORDER BY seps`, [sep || '/', r.fonte]);
  const dist = niveis.map((x) => `${x.seps + 1}níveis:${x.n}`).join(' ');
  console.log(`  ${String(r.fonte).padEnd(14)} sep='${sep}' ${dist}`);
  console.log(`     ex: ${ex.cat.slice(0, 110)}`);
}

// 3) OFF: categorias (string + tags)
const [[offCat]] = await pool.query(`
  SELECT COUNT(*) total, SUM(CASE WHEN NULLIF(categoria,'') IS NOT NULL THEN 1 ELSE 0 END) com_cat,
         SUM(CASE WHEN categorias_tags IS NOT NULL THEN 1 ELSE 0 END) com_tags
  FROM off_produto`);
console.log(`\n— off_produto: total=${offCat.total} c/categoria=${offCat.com_cat} c/categorias_tags=${offCat.com_tags}`);

// 4) simulação do VOTO-POR-VIZINHANÇA para um nome SEM EAN
const alvo = process.argv[2] || 'polpa de tomate';
const toks = norm(alvo).split(' ').filter((t) => t.length > 2);
console.log(`\n— Voto-por-vizinhança para "${alvo}" (tokens: ${toks.join(', ')}):`);
const cond = toks.map(() => 'nome_busca LIKE ?').join(' AND ');
let vizinhos;
try {
  [vizinhos] = await pool.query(
    `SELECT fonte, nome, COALESCE(NULLIF(categoria_path,''), categoria) AS cat
     FROM catalogo_produto WHERE ${cond} AND COALESCE(NULLIF(categoria_path,''), NULLIF(categoria,'')) IS NOT NULL LIMIT 200`,
    toks.map((t) => `%${t}%`));
} catch {
  // sem coluna nome_busca → cair para nome/nome_pt normalizado ao vivo (mais lento)
  [vizinhos] = await pool.query(
    `SELECT fonte, nome, nome_pt, COALESCE(NULLIF(categoria_path,''), categoria) AS cat
     FROM catalogo_produto WHERE COALESCE(NULLIF(categoria_path,''), NULLIF(categoria,'')) IS NOT NULL`);
  vizinhos = vizinhos.filter((v) => { const n = norm(`${v.nome_pt || ''} ${v.nome}`); return toks.every((t) => n.includes(t)); }).slice(0, 200);
}
console.log(`  vizinhos com categoria: ${vizinhos.length}`);
const voto = new Map();
for (const v of vizinhos) {
  const k = `${v.fonte} :: ${v.cat}`;
  voto.set(k, (voto.get(k) || 0) + 1);
}
const top = [...voto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [k, n] of top) console.log(`  ${String(n).padStart(3)}×  ${k.slice(0, 130)}`);
process.exit(0);

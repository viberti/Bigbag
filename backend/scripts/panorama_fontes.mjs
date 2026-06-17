// Panorama das fontes de dados: nº de produtos, EANs, fotos e nutrição por fonte.
// Uso (no servidor): sudo -u dev node --env-file=.env scripts/panorama_fontes.mjs
import { getPool, closePool } from '../src/db.js';

const pool = getPool();
const q = async (sql, args = []) => { const [r] = await pool.query(sql, args); return r; };
const cols = async (tabela) => {
  const r = await q(
    `SELECT COLUMN_NAME c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?`, [tabela]);
  return new Set(r.map((x) => x.c));
};
const existe = async (tabela) => {
  const r = await q(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`, [tabela]);
  return r.length > 0;
};
const n = (v) => Number(v || 0).toLocaleString('pt-PT');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// expressões defensivas conforme as colunas existentes
const eanExpr = (cs) => cs.has('ean') ? "COUNT(NULLIF(TRIM(ean),''))" : 'NULL';
const fotoExpr = (cs) => {
  for (const c of ['imagem', 'imagem_url', 'imagem_small', 'foto']) if (cs.has(c)) return `SUM(${c} IS NOT NULL AND TRIM(${c})<>'')`;
  return 'NULL';
};
const nutExpr = (cs) => {
  if (cs.has('nutricao')) return 'SUM(nutricao IS NOT NULL)';
  if (cs.has('energia_kcal')) return 'SUM(energia_kcal IS NOT NULL)';
  if (cs.has('nutricao_100g')) return 'SUM(nutricao_100g IS NOT NULL)';
  return 'NULL';
};

const linhas = []; // {fonte, prod, ean, foto, nut}

async function agrega(tabela, label, { groupBy } = {}) {
  if (!(await existe(tabela))) return;
  const cs = await cols(tabela);
  const sel = `COUNT(*) prod, ${eanExpr(cs)} ean, ${fotoExpr(cs)} foto, ${nutExpr(cs)} nut`;
  if (groupBy && cs.has(groupBy)) {
    const r = await q(`SELECT ${groupBy} g, ${sel} FROM ${tabela} GROUP BY ${groupBy} ORDER BY prod DESC`);
    for (const x of r) linhas.push({ fonte: `${label} · ${x.g || '—'}`, prod: x.prod, ean: x.ean, foto: x.foto, nut: x.nut });
  } else {
    const [x] = await q(`SELECT ${sel} FROM ${tabela}`);
    linhas.push({ fonte: label, prod: x.prod, ean: x.ean, foto: x.foto, nut: x.nut });
  }
}

await agrega('catalogo_produto', 'catálogo', { groupBy: 'fonte' });
await agrega('off_full', 'OFF completo (off_full)');
await agrega('off_produto', 'OFF dump antigo (off_produto)');
await agrega('produto_ean', 'fichas por EAN (produto_ean)');
await agrega('produto_generico', 'frescos genéricos (produto_generico)');
await agrega('produto_busca', 'índice de busca (produto_busca)');
await agrega('base_local', 'base local (telefone)', { groupBy: 'origem' });

// fotos de utilizador (produto_foto) — contagem à parte
let fotosUtil = null;
if (await existe('produto_foto')) {
  const [x] = await q('SELECT COUNT(*) total, COUNT(DISTINCT ean) eans FROM produto_foto');
  fotosUtil = x;
}

// imprimir tabela
const W = { f: 40, p: 12, e: 12, ft: 14, nu: 14 };
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const head = pad('FONTE', W.f) + padL('PRODUTOS', W.p) + padL('EANs', W.e) + padL('FOTOS', W.ft) + padL('NUTRIÇÃO', W.nu);
console.log('\n' + head);
console.log('─'.repeat(head.length));
const cel = (v, tot) => v == null ? '—' : `${n(v)}${tot ? ` (${pct(v, tot)}%)` : ''}`;
for (const l of linhas) {
  console.log(
    pad(l.fonte, W.f) +
    padL(n(l.prod), W.p) +
    padL(cel(l.ean), W.e) +
    padL(cel(l.foto, l.prod), W.ft) +
    padL(cel(l.nut, l.prod), W.nu)
  );
}
console.log('─'.repeat(head.length));
if (fotosUtil) console.log(`\nFotos tiradas por utilizadores (produto_foto): ${n(fotosUtil.total)} fotos · ${n(fotosUtil.eans)} EANs distintos`);

await closePool();

// Constrói marca_perfil (share food/não-food por marca) a partir do product_type (058)
// do catálogo. É a fatia "departamento" do perfil de marca do fusor de categoria
// (docs/Classificacao_Fusor.md §5). Reconstruível: TRUNCATE + reinsere. Correr no
// servidor após mudanças grandes no catálogo (ou no product_type):
//   sudo -u dev node --env-file=.env scripts/construir_marca_perfil.mjs
//
// Nota de circularidade (consciente): o share vem do product_type, que sai do tipoProduto
// determinístico. O AGREGADO por marca é, ainda assim, mais forte que qualquer produto
// isolado (lei dos grandes números) e só VOTA quando decisivo (>=0.9 / <=0.1), DEPOIS da
// nutrição e do VLM-tipo (sinais independentes). É um prior útil, não uma tautologia.
import { getPool, closePool } from '../src/db.js';
import { normAlfa } from '../src/normaliza/categoria.js';

const pool = getPool();
const [rows] = await pool.query(
  "SELECT marca, product_type FROM catalogo_produto WHERE marca IS NOT NULL AND marca <> ''");
const m = new Map();
for (const r of rows) {
  const k = normAlfa(r.marca);
  if (!k) continue;
  const o = m.get(k) || { ex: r.marca, n: 0, food: 0, non: 0 };
  o.n += 1;
  if (r.product_type === 'food') o.food += 1;
  else if (r.product_type === 'non_food') o.non += 1;
  m.set(k, o);
}
await pool.query('TRUNCATE TABLE marca_perfil');
const vals = [];
for (const [k, o] of m) {
  const cls = o.food + o.non;
  const share = cls > 0 ? o.food / cls : null;
  vals.push([k.slice(0, 160), String(o.ex).slice(0, 190), o.n, o.food, o.non, share]);
}
let ins = 0;
for (let i = 0; i < vals.length; i += 500) {
  const b = vals.slice(i, i + 500);
  await pool.query('INSERT INTO marca_perfil (marca_norm, marca_exemplo, n, n_food, n_nonfood, share_food) VALUES ?', [b]);
  ins += b.length;
}
console.log(`marca_perfil: ${ins} marcas (${rows.length} linhas de catálogo).`);
const [amostra] = await pool.query(
  `SELECT marca_exemplo, n, n_food, n_nonfood, ROUND(share_food,3) sf FROM marca_perfil
    WHERE n_food + n_nonfood >= 20 ORDER BY (n_food + n_nonfood) DESC LIMIT 12`);
console.log('amostra (>=20 classificados):');
for (const r of amostra) console.log(`  ${String(r.marca_exemplo).padEnd(20).slice(0,20)} n=${String(r.n).padStart(4)} food=${r.n_food} non=${r.n_nonfood} share=${r.sf}`);
await closePool();

// Mina `ean_empresa` (prefixo GS1 → marca dominante + país + coerência) dos nossos pares
// (ean, marca). O fusor usa o prefixo do EAN para rotear à marca/empresa mesmo SEM nome
// (caso Nesquik: empresa→Nestlé). `share` = pureza = peso do voto. Idempotente.
//   sudo -u dev node --env-file=.env scripts/construir_ean_empresa.mjs [L]
import { getPool, closePool } from '../src/db.js';
import { paisDoEan, eanValido } from '../src/normaliza/ean.js';

const L = Number(process.argv[2]) || 8; // comprimento do prefixo de empresa (GS1 7-10; 8 = meio razoável)
const pool = getPool();

const [a] = await pool.query("SELECT ean, marca FROM catalogo_produto WHERE marca IS NOT NULL AND marca <> '' AND ean REGEXP '^[0-9]{13}$'");
const [b] = await pool.query("SELECT ean, marca FROM produto_ean WHERE marca IS NOT NULL AND marca <> '' AND ean REGEXP '^[0-9]{13}$'");
const todos = [...a, ...b].filter((r) => eanValido(r.ean));
console.log(`pares (ean,marca) válidos: ${todos.length}`);

const porPrefixo = new Map(); // prefixo → Map(marcaNorm → {n, disp})
for (const r of todos) {
  const pre = String(r.ean).slice(0, L);
  const norm = String(r.marca).trim().toLowerCase();
  if (!norm) continue;
  if (!porPrefixo.has(pre)) porPrefixo.set(pre, new Map());
  const m = porPrefixo.get(pre);
  if (!m.has(norm)) m.set(norm, { n: 0, disp: r.marca });
  m.get(norm).n++;
}

const vals = [];
for (const [pre, marcas] of porPrefixo) {
  const arr = [...marcas.values()].sort((x, y) => y.n - x.n);
  const total = arr.reduce((s, x) => s + x.n, 0);
  if (total < 2) continue; // 1 produto não dá coerência
  const top = arr[0];
  const share = Number((top.n / total).toFixed(3));
  const pais = paisDoEan(pre.padEnd(13, '0'))?.iso || null;
  vals.push([pre, top.disp.slice(0, 140), pais, total, share]);
}

await pool.query('DELETE FROM ean_empresa');
for (let i = 0; i < vals.length; i += 500) await pool.query('INSERT INTO ean_empresa (prefixo, marca, pais, n_produtos, share) VALUES ?', [vals.slice(i, i + 500)]);

const altos = vals.filter((v) => v[4] >= 0.8);
const media = vals.length ? (vals.reduce((s, v) => s + v[4], 0) / vals.length) : 0;
console.log(`✅ ean_empresa: ${vals.length} prefixos (L=${L}) | share≥0.8: ${altos.length} (${Math.round(altos.length / vals.length * 100)}%) | share média: ${media.toFixed(2)}`);
console.log('\ntop prefixos por nº de produtos:');
for (const v of vals.sort((x, y) => y[3] - x[3]).slice(0, 12)) console.log(`  ${v[0]}  ${String(v[1]).padEnd(22)} ${v[2] || '--'}  n=${v[3]}  share=${v[4]}`);
await closePool();

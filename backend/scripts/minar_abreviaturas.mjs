// A3 — minera abreviaturas talão→expansão dos PARES JÁ VALIDADOS:
//   (a) produto_nome: variante 'talao' × melhor variante limpa do MESMO EAN
//   (b) match_ean_sugestao aprovadas: descrição × nome do catálogo
//   (c) sku_alias × nome_canonico (origem llm/manual)
// Heurísticas de alinhamento (alta precisão):
//   - PREFIXO: token do talão (≥3) é prefixo de token limpo (BOL→bolachas)
//   - ESQUELETO: consoantes do token limpo = abreviatura (QJ→queijo, LT→leite)
//   - INICIAIS: abreviatura = iniciais de 2 tokens limpos seguidos (FF→fatias finas)
// Aceita com suporte ≥2 → grava src/normaliza/abreviaturas_minadas.json;
// suporte 1 sai no relatório para curadoria manual (acrescentar ao SEED).
//   node scripts/minar_abreviaturas.mjs
import { writeFileSync } from 'node:fs';
import { getPool } from '../src/db.js';

const pool = getPool();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t.length >= 2 && !/^\d+$/.test(t));
const semVogais = (s) => s.replace(/[aeiou]/g, '');

const pares = [];
// (a) produto_nome: talão × limpa (canonico > off > catalogo) do mesmo EAN
const [pn] = await pool.query(`
  SELECT t.nome AS sujo, COALESCE(c.nome, o.nome, g.nome) AS limpo
    FROM produto_nome t
    LEFT JOIN produto_nome c ON c.ean = t.ean AND c.origem = 'canonico'
    LEFT JOIN produto_nome o ON o.ean = t.ean AND o.origem = 'off'
    LEFT JOIN produto_nome g ON g.ean = t.ean AND g.origem = 'catalogo'
   WHERE t.origem = 'talao'`);
pares.push(...pn.filter((p) => p.limpo));
// (b) aprovações da aba EANs × catálogo
const [ap] = await pool.query(`
  SELECT m.descricao AS sujo, cp.nome AS limpo
    FROM match_ean_sugestao m
    JOIN catalogo_produto cp ON cp.ean COLLATE utf8mb4_unicode_ci = m.ean COLLATE utf8mb4_unicode_ci
   WHERE m.estado = 'aprovado'`);
pares.push(...ap);
// (c) aliases × nome canónico
const [al] = await pool.query(
  'SELECT a.descricao_original AS sujo, s.nome_canonico AS limpo FROM sku_alias a JOIN sku_normalizado s ON s.id = a.sku_id');
pares.push(...al);
console.log(`Pares: ${pn.length} produto_nome + ${ap.length} aprovações + ${al.length} aliases = ${pares.length}`);

// vocabulário de palavras REAIS (não minar "MEL" como abreviatura de "melancia")
const [cat] = await pool.query("SELECT DISTINCT nome FROM catalogo_produto WHERE nome IS NOT NULL LIMIT 50000");
const reais = new Set();
for (const r of cat) for (const t of toks(r.nome)) reais.add(t);

const votos = new Map(); // 'abrev→expansao' → contagem
function vota(ab, exp) {
  if (reais.has(ab)) return; // palavra real, não abreviatura
  const k = `${ab}→${exp}`;
  votos.set(k, (votos.get(k) || 0) + 1);
}
for (const { sujo, limpo } of pares) {
  const ts = toks(sujo), tl = toks(limpo);
  const setL = new Set(tl);
  for (const a of ts) {
    if (a.length < 2 || a.length > 7 || setL.has(a)) continue;
    for (const l of tl) if (l.length > a.length && l.startsWith(a) && a.length >= 3) vota(a, l);
    for (const l of tl) if (l.length >= 4 && semVogais(l).startsWith(a) && a.length >= 2 && a.length <= 4 && a === semVogais(a)) vota(a, l);
    for (let i = 0; i + 1 < tl.length; i++) {
      if (a.length === 2 && a === tl[i][0] + tl[i + 1][0]) vota(a, `${tl[i]} ${tl[i + 1]}`);
    }
  }
}

// consolida: por abreviatura, a expansão mais votada; aceita suporte ≥2
const porAb = new Map();
for (const [k, n] of votos) {
  const [ab, exp] = k.split('→');
  const cur = porAb.get(ab);
  if (!cur || n > cur.n) porAb.set(ab, { exp, n });
}
const aceites = {}, rever = [];
for (const [ab, { exp, n }] of [...porAb].sort((x, y) => y[1].n - x[1].n)) {
  if (n >= 2) aceites[ab] = { expansao: exp, suporte: n };
  else rever.push(`${ab} → ${exp}`);
}
writeFileSync(new URL('../src/normaliza/abreviaturas_minadas.json', import.meta.url), JSON.stringify(aceites, null, 2));
console.log(`\nAceites (suporte ≥2) → abreviaturas_minadas.json: ${Object.keys(aceites).length}`);
for (const [ab, v] of Object.entries(aceites)) console.log(`   ${ab} → ${v.expansao} (×${v.suporte})`);
console.log(`\nPara curadoria (suporte 1): ${rever.length}`);
for (const r of rever.slice(0, 40)) console.log(`   ? ${r}`);
await pool.end();

// TESTE de extração: puxa produtos da API do Consum (ES, tem EAN real) por um
// cesto de termos de comida, e mede a sobreposição dos EANs com o nosso catálogo
// PT (o valor cross-fronteira: mesmo EAN, mesmo produto). NÃO importa nada.
//   sudo -u dev node --env-file=.env scripts/test_consum.mjs
import { getPool } from '../src/db.js';
import { eanValido } from '../src/ingest/produto.js';

const API = (t) => `https://tienda.consum.es/api/rest/V1.0/catalog/searcher/products?q=${encodeURIComponent(t)}&limit=40&showRecommendations=false`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TERMOS = ['aceite', 'leche', 'cafe', 'pasta', 'arroz', 'chocolate', 'cerveza', 'agua', 'yogur', 'galletas',
  'atun', 'tomate', 'harina', 'azucar', 'sal', 'queso', 'jamon', 'cereales', 'zumo', 'mantequilla',
  'pollo', 'refresco', 'vino', 'mermelada', 'miel', 'nutella', 'pan', 'huevos', 'pasta de dientes', 'detergente'];

const interno = (e) => ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'].includes(String(e).slice(0, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = getPool();
const carregar = async (tab) => { const [r] = await pool.query(`SELECT DISTINCT ean e FROM ${tab} WHERE ean IS NOT NULL AND ean<>''`); return new Set(r.map((x) => String(x.e))); };
const catPT = new Set([...await carregar('catalogo_produto')].filter((e) => true)); // todas as fontes
const [catFonte] = await pool.query("SELECT DISTINCT ean e FROM catalogo_produto WHERE fonte IN ('continente','auchan') AND ean<>''");
const ptEan = new Set(catFonte.map((x) => String(x.e)));
const offEan = await carregar('off_produto');
const jaTemos = new Set([...catPT, ...offEan]);

const prods = new Map(); // ean -> {ean, marca, nome, preco, img}
let erros = 0;
for (const t of TERMOS) {
  try {
    const r = await fetch(API(t), { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://tienda.consum.es/' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { erros++; continue; }
    const d = await r.json();
    for (const p of d?.catalog?.products || []) {
      const ean = String(p.ean || '');
      if (!eanValido(ean) || interno(ean)) continue;
      if (prods.has(ean)) continue;
      const pd = p.productData || {};
      const marca = (pd.brand && (pd.brand.id || pd.brand.name)) || '';
      const preco = (() => { try { return p.priceData?.prices?.[0]?.value ?? p.priceData?.prices?.[0]?.price ?? null; } catch { return null; } })();
      prods.set(ean, { ean, marca: String(marca), nome: pd.name || '', preco, img: pd.imageURL || '' });
    }
  } catch { erros++; }
  await sleep(300);
}

const todos = [...prods.values()];
const noPT = todos.filter((p) => ptEan.has(p.ean));        // já no catálogo PT (Continente/Auchan) — overlap direto
const noOff = todos.filter((p) => offEan.has(p.ean));      // já no nosso OFF
const novos = todos.filter((p) => !jaTemos.has(p.ean));    // EANs que NÃO temos — ganho
console.log('\n══════ TESTE CONSUM ══════');
console.log(`termos: ${TERMOS.length} · erros de fetch: ${erros}`);
console.log(`produtos distintos c/ EAN global: ${todos.length}`);
console.log(`  já no catálogo PT (Continente/Auchan): ${noPT.length}  ← MESMO EAN, juntam direto`);
console.log(`  já no nosso OFF:                       ${noOff.length}`);
console.log(`  NOVOS (não temos em lado nenhum):      ${novos.length}  ← ganho de identidade`);
console.log('\n── amostra de overlap DIRETO c/ PT (mesmo EAN nas duas lojas) ──');
for (const p of noPT.slice(0, 10)) console.log(`  ${p.ean}  ${p.marca.padEnd(14)} ${String(p.preco ?? '').padEnd(6)} ${p.nome.slice(0, 38)}`);
console.log('\n── amostra de NOVOS ──');
for (const p of novos.slice(0, 8)) console.log(`  ${p.ean}  ${p.marca.padEnd(14)} ${p.nome.slice(0, 40)}`);
await pool.end();

// EXPERIÊNCIA: transformar o nome abreviado do talão no nome real via catálogo,
// como um motor de busca — tokens + PREFIXO (BOL→Bolachas) + raridade (IDF).
//   node scripts/demo_busca_catalogo.mjs "BOL DIGESTIVE AVEIA CNT 425GR" ...
import { getPool } from '../src/db.js';

const STOP = new Set(['de','da','do','das','dos','e','com','sem','para','por','un','und','kg','g','gr','grs','ml','cl','l','lt','x']);
const MARCADORES = { cnt: 'continente', pd: 'pingo doce', aro: 'aro', mg: '', eq: '' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// tira formatos (425gr, 1kg, 500 g, 6x1l) e números soltos
const semFormato = (s) => norm(s).replace(/\b\d+([.,]\d+)?\s*(kg|gr?s?|ml|cl|lt?|un|unid)?\b/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => semFormato(s).split(' ').filter((t) => t.length >= 2 && !STOP.has(t));

const pool = getPool();
const [rows] = await pool.query("SELECT nome, marca, fonte, ean FROM catalogo_produto WHERE nome IS NOT NULL AND nome <> ''");

// IDF sobre os tokens do catálogo
const df = new Map();
for (const r of rows) for (const t of new Set(toks(r.nome))) df.set(t, (df.get(t) || 0) + 1);
const N = rows.length;
const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1));

function pontua(qtoks, cand) {
  const ctoks = toks(`${cand.nome} ${cand.marca || ''}`);
  let score = 0, possivel = 0;
  for (const qt of qtoks) {
    // marcador de cadeia expande (cnt→continente)
    const alvo = MARCADORES[qt] !== undefined ? (MARCADORES[qt] || null) : qt;
    if (alvo === null) continue;
    const w = idf(alvo) || 1;
    possivel += w;
    if (ctoks.includes(alvo)) score += w;                                  // token exato
    else if (alvo.length >= 3 && ctoks.some((c) => c.startsWith(alvo))) score += 0.85 * w; // PREFIXO: bol→bolachas
    else if (alvo.length >= 5 && ctoks.some((c) => alvo.startsWith(c) && c.length >= 4)) score += 0.6 * w;
  }
  return possivel ? score / possivel : 0;
}

for (const consulta of process.argv.slice(2)) {
  const qtoks = toks(consulta);
  const top = rows
    .map((r) => ({ r, s: pontua(qtoks, r) }))
    .filter((x) => x.s > 0.45)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  console.log(`\n"${consulta}"`);
  if (!top.length) console.log('   (sem candidatos acima do limiar)');
  for (const { r, s } of top) console.log(`   ${s.toFixed(2)}  ${r.nome}  [${r.marca || '—'}] (${r.fonte}${r.ean ? ', EAN ' + r.ean : ''})`);
}
await pool.end();

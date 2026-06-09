// Propostas de EAN para os itens CONTINENTE SEM EAN, usando o catálogo Continente +
// a fórmula combinada (comida rarity + preço-embalagem + marca-própria CNT→Continente).
// Mostra por banda de confiança. NÃO grava (é para reveres antes de aplicar).
//   node --env-file=.env scripts/match_continente_propor.mjs
import { getPool } from '../src/db.js';
import { candidatosCatalogo } from '../src/normaliza/resolverProduto.js';

const OPTS = { fonte: 'continente', portaMarca: false, limite: 30 };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t.length >= 3);
const prox = (a, b) => (a && b ? Math.abs(Math.log(a / b)) : 99);
const FAM_CONT = new Set(['continente', 'selecao', 'seleccao', 'equilibrio', 'bio', 'cozinha', 'kitchen']);

function bonusMarca(descRaw, marcaCand) {
  const ownReceipt = /\bcnt\b|continente/i.test(descRaw);
  const ownCand = /continente/.test(norm(marcaCand || ''));
  const bm = toks(marcaCand).filter((t) => !FAM_CONT.has(t));
  const hay = new Set(toks(descRaw));
  if (bm.length > 0 && bm.some((t) => hay.has(t))) return 0.4;
  if (ownReceipt && ownCand) return 0.35;
  if (ownReceipt && bm.length > 0) return -0.45;
  return 0;
}
const bonusPreco = (a, b) => { const p = prox(a, b); return p === 99 ? 0 : p < 0.1 ? 0.5 : p < 0.2 ? 0.3 : p < 0.4 ? 0.1 : 0; };

async function main() {
  const pool = getPool();
  const [itens] = await pool.query(`
    SELECT i.descricao_original d, MAX(s.nome_canonico) canon, AVG(i.preco_por_base) ppb,
           AVG(i.preco_liquido) preco, COUNT(*) compras
      FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
      LEFT JOIN sku_normalizado s ON s.id=i.sku_id
      LEFT JOIN produto_generico pg ON pg.sku_id=i.sku_id
     WHERE COALESCE(l.cadeia,l.nome)='Continente' AND i.is_non_product=0 AND i.ean IS NULL
       AND (pg.tipo IS NULL OR pg.tipo <> 'fresco')
       AND NOT EXISTS (SELECT 1 FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL)
     GROUP BY i.descricao_original ORDER BY i.descricao_original`);

  const props = [];
  let semCand = 0;
  for (const it of itens) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, preco_por_base: it.ppb }, OPTS);
    const bons = cand.filter((c) => c.score >= 0.4);
    if (!bons.length) { semCand++; continue; }
    const tot = (c) => c.score + bonusMarca(it.d, c.marca) + bonusPreco(it.preco, c.preco);
    const ranked = [...bons].map((c) => ({ c, t: tot(c) })).sort((a, b) => b.t - a.t);
    const top = ranked[0]; const segundo = ranked[1]?.t ?? 0;
    const margem = top.t - segundo;
    const precoBate = prox(it.preco, top.c.preco) < 0.15;
    // confiança: total combinado + margem + se o preço de embalagem bate de perto
    const banda = (top.t >= 1.1 && (precoBate || margem >= 0.3)) ? 'ALTA'
      : (top.t >= 0.8) ? 'MÉDIA' : 'BAIXA';
    props.push({ d: it.d, preco: it.preco, compras: it.compras, top: top.c, t: top.t, banda, precoBate });
  }

  const porBanda = { ALTA: [], 'MÉDIA': [], BAIXA: [] };
  for (const p of props) porBanda[p.banda].push(p);
  console.log('=== Propostas Continente (sem EAN) — combinado ===\n');
  console.log(`Itens sem EAN: ${itens.length} · com proposta: ${props.length} · sem candidato: ${semCand}`);
  for (const b of ['ALTA', 'MÉDIA', 'BAIXA']) {
    console.log(`\n──────── ${b} (${porBanda[b].length}) ────────`);
    for (const p of porBanda[b].sort((a, b2) => b2.t - a.t)) {
      console.log(`"${p.d}" €${p.preco?.toFixed?.(2) ?? '—'}${p.compras > 1 ? ` ×${p.compras}` : ''}`);
      console.log(`   → ${String(p.top.nome).slice(0, 46)} [${p.top.marca || '?'}] €${p.top.preco?.toFixed?.(2) ?? '—'} ${p.precoBate ? '💶' : ''} ean ${p.top.ean}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

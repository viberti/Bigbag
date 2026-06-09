// Match Continente → catálogo Continente, COMBINADO: comida (rarity) + preço de
// EMBALAGEM (forte, mesma loja) + MARCA (CNT/CONTINENTE → marca-própria "Continente%";
// marca nacional no talão → bónus; marca diferente num item de marca-própria → penaliza).
// Mede a precisão vs o teto. NÃO grava.
//   node --env-file=.env scripts/match_continente_full.mjs
import { getPool } from '../src/db.js';
import { candidatosCatalogo } from '../src/normaliza/resolverProduto.js';

const OPTS = { fonte: 'continente', portaMarca: false, limite: 30 };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t.length >= 3);
const prox = (a, b) => (a && b ? Math.abs(Math.log(a / b)) : 99);
const FAM_CONT = new Set(['continente', 'selecao', 'seleccao', 'equilibrio', 'bio', 'cozinha', 'kitchen']);

function bonusMarca(descRaw, marcaCand) {
  const ownReceipt = /\bcnt\b|continente/i.test(descRaw);
  const mNorm = norm(marcaCand || '');
  const ownCand = /^continente/.test(mNorm) || /continente/.test(mNorm);
  const bm = toks(marcaCand).filter((t) => !FAM_CONT.has(t)); // tokens de marca NACIONAL
  const hay = new Set(toks(descRaw));
  const marcaNacionalBate = bm.length > 0 && bm.some((t) => hay.has(t));
  if (marcaNacionalBate) return 0.4;            // marca explícita do talão bate (Santiago, Carlsberg)
  if (ownReceipt && ownCand) return 0.35;       // item marca-própria → candidato Continente
  if (ownReceipt && bm.length > 0) return -0.45; // item marca-própria → candidato é OUTRA marca real
  return 0;
}
function bonusPreco(itPreco, candPreco) {
  const p = prox(itPreco, candPreco);
  if (p === 99) return 0;
  return p < 0.1 ? 0.5 : p < 0.2 ? 0.3 : p < 0.4 ? 0.1 : p > 0.6 ? -0.4 : 0;
}

async function main() {
  const pool = getPool();
  const [comEan] = await pool.query(`
    SELECT i.descricao_original d, MAX(s.nome_canonico) canon, MAX(pe.ean) ean,
           AVG(i.preco_por_base) ppb, AVG(i.preco_liquido) preco
      FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
      JOIN produto_ean pe ON pe.item_id=i.id LEFT JOIN sku_normalizado s ON s.id=i.sku_id
     WHERE COALESCE(l.cadeia,l.nome)='Continente' AND i.is_non_product=0 AND pe.ean IS NOT NULL
     GROUP BY i.descricao_original`);

  let total = 0, inCand = 0, topComb = 0;
  const ok = [], ko = [];
  for (const it of comEan) {
    const cand = await candidatosCatalogo(pool, { descricao: it.canon || it.d, preco_por_base: it.ppb }, OPTS);
    const bons = cand.filter((c) => c.score >= 0.4);
    if (!bons.length) continue;
    total++;
    const conhecido = String(it.ean);
    if (bons.some((c) => String(c.ean) === conhecido)) inCand++;
    const tot = (c) => c.score + bonusMarca(it.d, c.marca) + bonusPreco(it.preco, c.preco);
    const ranked = [...bons].sort((a, b) => tot(b) - tot(a));
    const acertou = String(ranked[0].ean) === conhecido;
    if (acertou) topComb++;
    const linha = `"${it.d}" €${it.preco?.toFixed?.(2) ?? '—'} → ${ranked[0].nome.slice(0, 30)} [${ranked[0].marca || '?'}] €${ranked[0].preco?.toFixed?.(2) ?? '—'}`;
    if (acertou) ok.push(linha);
    else if (bons.some((c) => String(c.ean) === conhecido)) ko.push(linha + ` (real: ${bons.find((c) => String(c.ean) === conhecido).nome.slice(0, 26)})`);
  }
  console.log('=== Continente COMBINADO (comida + preço-embalagem + marca) ===\n');
  console.log(`Itens com candidatos: ${total}`);
  console.log(`EAN certo ENTRE candidatos: ${inCand}/${total} (${Math.round(100 * inCand / total)}%) ← teto`);
  console.log(`Topo certo (COMBINADO): ${topComb}/${total} (${Math.round(100 * topComb / total)}%)`);
  console.log(`\n── acertos (${ok.length}) ──\n  ${ok.join('\n  ')}`);
  console.log(`\n── ainda errados, mas o real estava nos candidatos ──\n  ${ko.join('\n  ')}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

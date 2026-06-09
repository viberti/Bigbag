// Propaga o EAN de um produto IDENTIFICADO às outras compras do MESMO produto cuja
// descrição difere só por ERRO DE OCR — mesmo SKU + mesma cadeia + descrição muito
// parecida (razão de caracteres ≥ LIMIAR). Resolve "CEREATS KELLOGGS" vs "CEREAIS
// KELLOGG S" SEM fundir produtos diferentes ("AGROS"≠"CNT", "LATA 33"≠"TP 25" têm
// semelhança baixa). Grava o EAN confirmado em item.ean (autoritativo).
//   node --env-file=.env scripts/propagar_ean_ocr.mjs           (preview)
//   node --env-file=.env scripts/propagar_ean_ocr.mjs --apply
import { getPool } from '../src/db.js';
import { razaoCaractere } from '../src/normaliza/similaridade.js';

const APPLY = process.argv.includes('--apply');
const LIMIAR = 0.85;
const pool = getPool();

// peso/volume lido no nome ("330g", "475g", "6*1l"); null se não houver.
const tamanho = (d) => {
  const m = String(d).match(/(\d+\s*[x*]\s*)?\d+[.,]?\d*\s*(kg|gr?s?|ml|cl|lt|l|un|dz)\b/i);
  return m ? m[0].replace(/\s+/g, '').toLowerCase() : null;
};
// só funde se o TAMANHO bater (ou ambos sem tamanho) — OCR muda letras, não o pack.
const mesmoTamanho = (a, b) => { const ta = tamanho(a), tb = tamanho(b); return !ta || !tb ? true : ta === tb; };

const [ident] = await pool.query(`
  SELECT i.id, i.sku_id, i.descricao_original d, COALESCE(l.cadeia,l.nome) cadeia,
         (SELECT MAX(pe.ean) FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL) ean
    FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
   WHERE i.sku_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL)`);
const [orfaos] = await pool.query(`
  SELECT i.id, i.sku_id, i.descricao_original d, COALESCE(l.cadeia,l.nome) cadeia
    FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
   WHERE i.ean IS NULL AND i.sku_id IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM produto_ean pe WHERE pe.item_id=i.id AND pe.ean IS NOT NULL)`);

let n = 0; const rejeitados = [];
for (const o of orfaos) {
  // se já houver um identificado com a MESMA descrição+cadeia, já está coberto (não toca).
  if (ident.some((x) => x.cadeia === o.cadeia && x.d === o.d)) continue;
  // candidatos: mesmo sku+cadeia, descrição DIFERENTE, com EAN.
  const cands = ident
    .filter((x) => x.sku_id === o.sku_id && x.cadeia === o.cadeia && x.d !== o.d && x.ean && mesmoTamanho(o.d, x.d))
    .map((x) => ({ x, s: razaoCaractere(o.d, x.d) }))
    .sort((a, b) => b.s - a.s);
  const top = cands[0];
  if (!top) continue;
  if (top.s >= LIMIAR) {
    n++;
    console.log(`✓ #${o.id} "${o.d}"  ←  "${top.x.d}"  (${(top.s * 100).toFixed(0)}%)  ean ${top.x.ean}`);
    if (APPLY) await pool.query('UPDATE item SET ean = ? WHERE id = ?', [top.x.ean, o.id]);
  } else if (rejeitados.length < 12) {
    rejeitados.push(`✗ #${o.id} "${o.d}"  vs  "${top.x.d}"  (${(top.s * 100).toFixed(0)}% < ${LIMIAR * 100}%) — produtos diferentes, não funde`);
  }
}
console.log(`\n── descartados (semelhança baixa = produto diferente) ──\n${rejeitados.join('\n')}`);
console.log(`\n${APPLY ? '✓ aplicado' : 'preview'}: ${n} órfãos resolvidos por OCR-similaridade`);
process.exit(0);

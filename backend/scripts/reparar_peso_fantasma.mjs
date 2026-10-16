// Repara o "PESO FANTASMA" (2026-10-16): linhas de talão (sobretudo PDF/ocr_llm) com
// linha_peso "1 kg x P EUR/kg" e €/kg == preço pago — não é pesagem, é o preço copiado para um
// produto EMBALADO ("QJ FRS MONTIQJ 200G" → queijo a 0,92 €/kg). O guard novo em normalize.js
// impede novos casos; isto corrige os antigos: limpa a linha_peso e recalcula o €/kg da fatura
// (recomputarPpbFatura: tamanho no nome → €/kg certo; sem tamanho → peso_em_falta, nunca inventa).
// Guarda os valores anteriores em /home/dev/reparar_peso_fantasma_<data>.json (reversível).
//   sudo -u dev node --env-file=.env scripts/reparar_peso_fantasma.mjs           (pré-visualiza)
//   sudo -u dev node --env-file=.env scripts/reparar_peso_fantasma.mjs --apply   (aplica)
import { writeFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { recomputarPpbFatura } from '../src/normaliza/ppb.js';

const APLICAR = process.argv.includes('--apply');
const pool = getPool();
const [alvos] = await pool.query(
  `SELECT i.id, i.fatura_id, i.descricao_original, i.preco_liquido, i.linha_peso, i.preco_por_base, i.peso_em_falta
     FROM item i
    WHERE i.linha_peso REGEXP '^1([.,]0+)? ?kg( x|$)' AND ABS(i.preco_por_base - i.preco_liquido) < 0.01`);
console.log(`${alvos.length} linhas com peso fantasma${APLICAR ? '' : ' (pré-visualização — use --apply)'}`);
if (APLICAR && alvos.length) {
  const ficheiro = `/home/dev/reparar_peso_fantasma_${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(ficheiro, JSON.stringify(alvos, null, 1));
  console.log(`valores anteriores guardados em ${ficheiro}`);
  await pool.query('UPDATE item SET linha_peso = NULL WHERE id IN (?)', [alvos.map((a) => a.id)]);
  for (const fid of new Set(alvos.map((a) => a.fatura_id))) await recomputarPpbFatura(pool, fid);
  const [depois] = await pool.query('SELECT id, preco_por_base, peso_em_falta FROM item WHERE id IN (?)', [alvos.map((a) => a.id)]);
  const d = new Map(depois.map((x) => [x.id, x]));
  for (const a of alvos) {
    const x = d.get(a.id);
    console.log(`  ${a.descricao_original.padEnd(26)} pago ${a.preco_liquido}  €/base ${a.preco_por_base} → ${x.preco_por_base ?? '—'}${x.peso_em_falta ? ' (peso em falta)' : ''}`);
  }
} else {
  for (const a of alvos) console.log(`  ${a.descricao_original.padEnd(26)} pago ${a.preco_liquido}  linha "${a.linha_peso}"`);
}
await closePool();

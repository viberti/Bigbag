// Backfill da tabela produto_nome a partir dos produto_ean já identificados:
// junta nome canónico + descrição do talão + nome do VLM + nome do OFF, por EAN.
//   node --env-file=.env scripts/backfill_nomes.mjs
import { getPool } from '../src/db.js';

const pool = getPool();
const [rows] = await pool.query(`
  SELECT pe.ean, pe.item_id,
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pe.vlm_json,'$.nome')), 'null') AS vlm,
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pe.off_json,'$.nome')), 'null') AS off,
         i.sku_id, i.descricao_original AS talao, s.nome_canonico AS canonico
    FROM produto_ean pe
    LEFT JOIN item i ON i.id = pe.item_id
    LEFT JOIN sku_normalizado s ON s.id = i.sku_id
   WHERE pe.ean IS NOT NULL`);

let n = 0;
for (const r of rows) {
  const nomes = [
    { nome: r.canonico, origem: 'canonico' },
    { nome: r.talao, origem: 'talao' },
    { nome: r.vlm, origem: 'vlm' },
    { nome: r.off, origem: 'off' },
  ];
  const vistos = new Set();
  for (const { nome, origem } of nomes) {
    const nm = String(nome || '').trim();
    if (!nm || /^null$/i.test(nm) || vistos.has(nm.toLowerCase())) continue;
    vistos.add(nm.toLowerCase());
    const [res] = await pool.query('INSERT IGNORE INTO produto_nome (ean, sku_id, nome, origem) VALUES (?,?,?,?)', [r.ean, r.sku_id || null, nm, origem]);
    n += res.affectedRows;
  }
}
const [[t]] = await pool.query('SELECT COUNT(*) c, COUNT(DISTINCT ean) e FROM produto_nome');
console.log(`Inseridos ${n} nomes. Total: ${t.c} nomes para ${t.e} EANs.`);
process.exit(0);

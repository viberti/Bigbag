// Sugere um nome canónico melhor para os SKUs que têm variantes de nome
// (produto_nome), via LLM. Dry-run por omissão (lista antes→depois); com
// --aplicar grava em sku_normalizado.nome_canonico (com guarda anti-colisão).
//   node --env-file=.env scripts/sugerir_nomes.mjs            (dry-run)
//   node --env-file=.env scripts/sugerir_nomes.mjs --aplicar  (aplica)
import { getPool } from '../src/db.js';
import { sugerirNomeCanonico } from '../src/ingest/produto.js';

const APLICAR = process.argv.includes('--aplicar');
const pool = getPool();
const norm = (s) => String(s || '').trim().toLowerCase();

// SKUs com variantes de nome + o nome canónico atual.
const [skus] = await pool.query(`
  SELECT s.id, s.nome_canonico AS atual, GROUP_CONCAT(pn.nome SEPARATOR '||') AS variantes
    FROM produto_nome pn JOIN sku_normalizado s ON s.id = pn.sku_id
   GROUP BY s.id, s.nome_canonico
   ORDER BY s.id`);

let custo = 0, sugeridos = 0, aplicados = 0;
for (const s of skus) {
  const variantes = String(s.variantes || '').split('||');
  const { nome, custo: c } = await sugerirNomeCanonico(variantes);
  custo += c || 0;
  if (!nome || norm(nome) === norm(s.atual)) continue; // sem mudança relevante
  sugeridos++;
  console.log(`sku ${s.id}: "${s.atual}"  →  "${nome}"   [${variantes.join(' | ')}]`);
  if (APLICAR) {
    // anti-colisão: não criar nome canónico igual a outro SKU (evita merges errados)
    const [[col]] = await pool.query('SELECT id FROM sku_normalizado WHERE LOWER(nome_canonico) = LOWER(?) AND id <> ?', [nome, s.id]);
    if (col) { console.log(`   (saltado: colide com sku ${col.id})`); continue; }
    await pool.query('UPDATE sku_normalizado SET nome_canonico = ? WHERE id = ?', [nome, s.id]);
    aplicados++;
  }
}
console.log(`\n${sugeridos} sugestões${APLICAR ? `, ${aplicados} aplicados` : ' (dry-run)'}. Custo ~$${custo.toFixed(4)}.`);
process.exit(0);

// Regenera o GOLDEN SET da classificação (test/fixtures/golden_grupos.json).
// Corre NO SERVIDOR (precisa da BD) e escreve o JSON no stdout; do PC:
//   ssh pitacos-prod "cd /home/dev/bigbag/backend && sudo -u dev node scripts/gerar_golden_grupos.mjs" \
//     > backend/test/fixtures/golden_grupos.json
// Usar DEPOIS de uma mudança intencional de vocabulário + backfill_grupos.mjs —
// o diff do fixture commitado é a documentação da mudança. As FONTES (query) são
// idênticas às do backfill: divergência teste-vs-BD significa drift real.
import { getPool } from '../src/db.js';
import { grupoDeNome } from '../src/normaliza/categoria.js';

const pool = getPool();
const [skus] = await pool.query(`
  SELECT s.nome_canonico AS nome, s.nome_simplificado AS simplificado, s.categoria, pg.categoria AS cat_gen, s.grupo AS ouro,
    (SELECT pe.off_json->'$.grupos_alimento' FROM item i JOIN produto_ean pe ON pe.ean = i.ean
      WHERE i.sku_id = s.id AND pe.off_json IS NOT NULL LIMIT 1) AS fg
  FROM sku_normalizado s LEFT JOIN produto_generico pg ON pg.sku_id = s.id
  WHERE s.grupo IS NOT NULL ORDER BY s.id`);
const casos = skus.map((s) => ({
  nome: s.nome, simplificado: s.simplificado || null, categoria: s.categoria || null, cat_gen: s.cat_gen || null,
  foodGroups: (() => { try { const v = typeof s.fg === 'string' ? JSON.parse(s.fg) : s.fg; return Array.isArray(v) && v.length ? v : null; } catch { return null; } })(),
  ouro: s.grupo,
}));
const [lista] = await pool.query('SELECT DISTINCT nome FROM lista_item WHERE nome IS NOT NULL');
const [desp] = await pool.query('SELECT DISTINCT nome FROM despensa WHERE nome IS NOT NULL');
const nomes = [...new Set([...lista.map((x) => x.nome), ...desp.map((x) => x.nome)])];
const scan = nomes.map((nome) => ({ nome, esperado: grupoDeNome(nome) }));

console.log(JSON.stringify({
  gerado: new Date().toISOString().slice(0, 10),
  nota: 'Regenerar com backend/scripts/gerar_golden_grupos.mjs (ver cabeçalho). Mudança INTENCIONAL de vocabulário => regenerar e commitar o diff no mesmo commit.',
  casos, scan,
}, null, 1));
process.exit(0);

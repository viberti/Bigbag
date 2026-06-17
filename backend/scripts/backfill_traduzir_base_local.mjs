// Corretivo do backfill: o pareceEstrangeiro (regex estreito: leche/huevos/queso…) deixou passar
// ESPANHOL geral dos produtos Mercadona ("Te Verde", "Lasagna Boloñesa", "Queijo Viejo"), que foram
// promovidos a 'uso' sem traduzir. Este passo faz TRADUZIR-OU-MANTÉM (LLM, lote) os produtos de
// origem Mercadona já em 'uso' + os restantes estrangeiros, e re-promove os que mudam (delete+reinsert
// → seq novo → telefone re-sincroniza o nome corrigido). Idempotente. Salta nomes-lixo (puro número).
//   sudo -u dev node --env-file=.env scripts/backfill_traduzir_base_local.mjs
import { getPool, closePool, parseJsonCol } from '../src/db.js';
import { chatCompletion } from '../src/openrouter.js';
import { parseJsonLoose } from '../src/ingest/extract.js';
import { config } from '../src/config.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const PROMPT = `Recebes uma lista NUMERADA de nomes de produtos de supermercado. Alguns já estão em PORTUGUÊS, outros em ESPANHOL/estrangeiro. Para CADA um: se JÁ estiver em bom português, devolve-o IGUAL; se estiver em espanhol/estrangeiro, TRADUZ para português MANTENDO marca, tamanho e tipo. É NOME DE PRODUTO (não genérico), NÃO inventes. Ex.: "Queijo Fresco Batido"→"Queijo Fresco Batido"; "Te Verde"→"Chá Verde"; "Lasagna Boloñesa"→"Lasanha à Bolonhesa"; "Aceite de oliva"→"Azeite". Devolve SÓ {"r":["<pt 1>", …]} com EXATAMENTE o mesmo número, pela ordem.`;

function extrair(content) {
  let obj; try { obj = JSON.parse(content); } catch { try { obj = parseJsonLoose(content); } catch { return null; } }
  const r = obj?.r ?? (Array.isArray(obj) ? obj : null);
  return Array.isArray(r) ? r.map((x) => (x == null ? '' : String(x).trim())) : null;
}
async function traduzir(nomes) {
  const pt = new Array(nomes.length).fill(null);
  for (let i = 0; i < nomes.length; i += 50) {
    const lote = nomes.slice(i, i + 50);
    const user = lote.map((en, k) => `${k + 1}. ${en}`).join('\n');
    let r = null;
    for (let tent = 0; tent < 2 && !r; tent++) {
      try {
        const content = await chatCompletion({ messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: user }],
          model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, contexto: 'traducao' });
        const c = extrair(content); if (c && c.length === lote.length) r = c;
      } catch { /* retry */ }
    }
    if (r) for (let k = 0; k < lote.length; k++) pt[i + k] = r[k] || null;
    if ((i / 50) % 20 === 0) console.log(`  …${Math.min(i + 50, nomes.length)}/${nomes.length}`);
  }
  return pt;
}
async function promover(pool, rows) { // delete+reinsert como 'uso' (seq novo via AUTO_INCREMENT)
  for (let i = 0; i < rows.length; i += 300) {
    const b = rows.slice(i, i + 300); const eans = b.map((r) => r.ean);
    await pool.query(`DELETE FROM base_local WHERE ean IN (${eans.map(() => '?').join(',')})`, eans);
    const vals = b.map((r) => [r.ean, String(r.nome).slice(0, 255), r.marca, r.quantidade, r.categoria,
      r.alergenios, r.nutricao != null ? JSON.stringify(r.nutricao) : null, r.ingredientes, 'uso']);
    await pool.query(`INSERT INTO base_local (ean,nome,marca,quantidade,categoria,alergenios,nutricao,ingredientes,origem)
         VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}`, vals.flat());
  }
}

async function main() {
  const pool = getPool();
  const [rows] = await pool.query(`
    SELECT b.ean,b.nome,b.marca,b.quantidade,b.categoria,b.alergenios,b.nutricao,b.ingredientes,b.origem
      FROM base_local b
     WHERE b.nome NOT REGEXP '^[0-9 ]+$' AND (
       b.origem IN ('pt_off','merc_es','uso_es')
       OR (b.origem = 'uso' AND EXISTS (SELECT 1 FROM catalogo_produto c WHERE c.ean = b.ean AND c.fonte LIKE '%merc%')))`);
  for (const r of rows) r.nutricao = parseJsonCol(r.nutricao);
  console.log(`alvos (traduzir-ou-manter): ${rows.length}`);
  const pt = await traduzir(rows.map((r) => r.nome));
  const mudar = [];
  for (let i = 0; i < rows.length; i++) {
    const t = pt[i] ? tituloProduto(pt[i]) : null;
    if ((t && t !== rows[i].nome) || rows[i].origem !== 'uso') mudar.push({ ...rows[i], nome: t || rows[i].nome });
  }
  await promover(pool, mudar);
  console.log(`✅ atualizados/promovidos: ${mudar.length} (mantidos iguais: ${rows.length - mudar.length})`);
  const [d] = await pool.query('SELECT origem, COUNT(*) n FROM base_local GROUP BY origem ORDER BY n DESC');
  console.log('=== base_local por origem ==='); for (const x of d) console.log('  ', x.origem.padEnd(10), x.n);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

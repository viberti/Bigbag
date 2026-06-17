// Backfill: promove os pt_off/merc_es/uso_es da base_local para 'uso' (HIT local instantâneo no scan).
// Os de nome PT-FIÁVEL são promovidos DIRETO (sem LLM); os estrangeiros são TRADUZIDOS em lote (LLM)
// e depois promovidos. Promoção = DELETE+REINSERT (origem 'uso', seq NOVO via AUTO_INCREMENT → o
// AUTO_INCREMENT avança certo e o telefone re-sincroniza). Idempotente (os já 'uso' saem do WHERE).
//   sudo -u dev node --env-file=.env scripts/backfill_promover_base_local.mjs [--so-pt]
//   --so-pt  : só promove os de nome PT-fiável (sem traduzir nada; rápido e grátis)
import { getPool, closePool } from '../src/db.js';
import { parseJsonCol } from '../src/db.js';
import { pareceEstrangeiro } from '../src/ingest/traduz.js';
import { chatCompletion } from '../src/openrouter.js';
import { parseJsonLoose } from '../src/ingest/extract.js';
import { config } from '../src/config.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const PROMPT = `Recebes uma lista NUMERADA de nomes de PRODUTOS de supermercado em ESPANHOL (ou outra língua). Traduz cada um para PORTUGUÊS, MANTENDO a marca, o tamanho e o tipo — é um NOME DE PRODUTO (ex.: "Aceite de oliva virgen extra Hacendado"→"Azeite virgem extra Hacendado"; "Leche entera"→"Leite gordo"; "Huevos frescos"→"Ovos frescos"). NÃO genérico, NÃO inventes. Devolve SÓ {"r":["<pt 1>","<pt 2>", …]} com EXATAMENTE o mesmo número de nomes, pela ordem.`;

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
        const cand = extrair(content); if (cand && cand.length === lote.length) r = cand;
      } catch { /* retry */ }
    }
    if (r) for (let k = 0; k < lote.length; k++) pt[i + k] = r[k] || null;
    if ((i / 50) % 20 === 0) console.log(`  …traduzido ${Math.min(i + 50, nomes.length)}/${nomes.length}`);
  }
  return pt;
}

// Promove (DELETE+REINSERT como 'uso') um conjunto de fichas completas; nome pode vir sobreposto (tradução).
async function promover(pool, rows) {
  for (let i = 0; i < rows.length; i += 300) {
    const b = rows.slice(i, i + 300);
    const eans = b.map((r) => r.ean);
    await pool.query(`DELETE FROM base_local WHERE ean IN (${eans.map(() => '?').join(',')})`, eans);
    const vals = b.map((r) => [r.ean, String(r.nome).slice(0, 255), r.marca, r.quantidade, r.categoria,
      r.alergenios, r.nutricao != null ? JSON.stringify(r.nutricao) : null, r.ingredientes, 'uso']);
    await pool.query(
      `INSERT INTO base_local (ean,nome,marca,quantidade,categoria,alergenios,nutricao,ingredientes,origem)
         VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}`, vals.flat());
  }
}

async function main() {
  const soPt = process.argv.includes('--so-pt');
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT ean, nome, marca, quantidade, categoria, alergenios, nutricao, ingredientes, origem FROM base_local WHERE origem IN ('pt_off','merc_es','uso_es')");
  for (const r of rows) r.nutricao = parseJsonCol(r.nutricao);
  const ptOk = []; const estrangeiros = [];
  for (const r of rows) (pareceEstrangeiro(r.nome) ? estrangeiros : ptOk).push(r);
  console.log(`alvos: ${rows.length} (PT-fiáveis: ${ptOk.length} · estrangeiros: ${estrangeiros.length})`);

  await promover(pool, ptOk);
  console.log(`✓ promovidos DIRETO (nome já PT): ${ptOk.length}`);

  if (!soPt && estrangeiros.length) {
    console.log(`a traduzir ${estrangeiros.length} nomes estrangeiros…`);
    const pt = await traduzir(estrangeiros.map((r) => r.nome));
    const traduz = [];
    for (let i = 0; i < estrangeiros.length; i++) {
      const t = pt[i];
      if (t && !pareceEstrangeiro(t)) traduz.push({ ...estrangeiros[i], nome: tituloProduto(t) });
    }
    await promover(pool, traduz);
    console.log(`✓ traduzidos+promovidos: ${traduz.length} (ficaram estrangeiros: ${estrangeiros.length - traduz.length})`);
  }

  const [[c]] = await pool.query("SELECT origem, COUNT(*) n FROM base_local GROUP BY origem ORDER BY n DESC");
  const [d] = await pool.query("SELECT origem, COUNT(*) n FROM base_local GROUP BY origem");
  console.log('=== base_local por origem (depois) ==='); for (const x of d) console.log('  ', x.origem.padEnd(10), x.n);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

// FASE 2b: classifica os AMBÍGUOS (product_type IS NULL) com LLM, em LOTE.
// Tarefa trivial (nome → food/non_food) → ~100 por chamada, barato e one-time.
// Idempotente/resumível (só os NULL). Custo registado na aba Custos (contexto).
//   sudo -u dev node --env-file=.env scripts/classificar_ambiguos_llm.mjs
//   LIMITE=2 node … scripts/classificar_ambiguos_llm.mjs   (testar 2 lotes)
import { getPool } from '../src/db.js';
import { chatCompletion } from '../src/openrouter.js';
import { config } from '../src/config.js';

const LOTE = 100;
const LIMITE = Number(process.env.LIMITE || 0); // nº de lotes (0 = todos)
const pool = getPool();

const SYS = `Classificas produtos de supermercado (PT/ES) em ALIMENTO ou NÃO-ALIMENTO.
ALIMENTO ("food") = comida ou bebida para consumo humano — INCLUI água, vinho, cerveja, café, chá, especiarias, sal, açúcar, azeite, suplementos alimentares.
NÃO-ALIMENTO ("non_food") = limpeza, higiene, cosmética/beleza, casa, papelaria, animais (ração/acessórios), brinquedos, roupa, pilhas, jardim, etc.
Responde SÓ com um objeto JSON {"<numero>": "food"|"non_food"} para CADA item. Sem texto fora do JSON.`;

const parse = (s) => { try { return JSON.parse(String(s).replace(/```(json)?/gi, '').trim()); } catch { return null; } };

let lotes = 0, total = 0, food = 0, non = 0, falhou = 0;
for (;;) {
  const [rows] = await pool.query(
    `SELECT id, COALESCE(nome_pt, nome) AS nome, categoria FROM catalogo_produto
      WHERE product_type IS NULL AND COALESCE(nome_pt, nome) IS NOT NULL AND COALESCE(nome_pt, nome) <> ''
      ORDER BY id LIMIT ?`, [LOTE]);
  if (!rows.length) break;
  const lista = rows.map((r, i) => `${i + 1}. ${r.nome}${r.categoria ? ` [${r.categoria}]` : ''}`).join('\n');
  let mapa = null;
  try {
    const out = await chatCompletion({
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: `Classifica:\n${lista}` }],
      model: config.openrouter.modelExtracao,
      responseFormat: { type: 'json_object' },
      timeoutMs: 30000,
      contexto: 'classificar_tipo',
    });
    mapa = parse(out);
  } catch (e) { console.error('  lote falhou:', e.message); }
  const foodIds = [], nonIds = [];
  rows.forEach((r, i) => {
    const v = mapa?.[String(i + 1)];
    if (v === 'food') foodIds.push(r.id);
    else if (v === 'non_food') nonIds.push(r.id);
    else falhou++; // sem resposta válida → fica NULL (re-tenta numa próxima corrida)
  });
  if (foodIds.length) await pool.query(`UPDATE catalogo_produto SET product_type='food' WHERE id IN (${foodIds.map(() => '?').join(',')})`, foodIds);
  if (nonIds.length) await pool.query(`UPDATE catalogo_produto SET product_type='non_food' WHERE id IN (${nonIds.map(() => '?').join(',')})`, nonIds);
  food += foodIds.length; non += nonIds.length; total += rows.length; lotes++;
  console.error(`  lote ${lotes}: +${foodIds.length} food, +${nonIds.length} non_food (acum: food ${food}, non ${non}, s/resposta ${falhou})`);
  if (LIMITE && lotes >= LIMITE) break;
  // se um lote inteiro falhou a classificar (sem update), parar para não rodar em vazio
  if (!foodIds.length && !nonIds.length) { console.error('  lote sem classificações — a parar.'); break; }
}
console.log(`\n✅ ${total} processados — food +${food}, non_food +${non}, sem-resposta ${falhou}.`);
const [[c]] = await pool.query("SELECT COUNT(*) restam FROM catalogo_produto WHERE product_type IS NULL");
console.log(`ainda NULL: ${c.restam}`);
const [[ct]] = await pool.query("SELECT ROUND(SUM(custo),4) usd, COUNT(*) chamadas FROM custo_chamada WHERE contexto='classificar_tipo'");
console.log(`custo acumulado (classificar_tipo): $${ct.usd || 0} em ${ct.chamadas || 0} chamadas`);
await pool.end();
process.exit(0);

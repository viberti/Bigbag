// Backfill BOUNDED: traduz nome -> nome_pt no catálogo das fontes ESTRANGEIRAS
// compráveis (Mercadona-ES, Lidl-FR) para entrarem no índice de busca PT (produto_busca).
// NÃO é o OFF (4,5M, esse fica lazy) — ~14k finitos com propósito (decisão dono 2026-06-15).
// Em lote (~40/chamada). Idempotente: só onde nome_pt IS NULL. Re-correr após novos scrapes.
//   sudo -u dev node --env-file=.env scripts/traduzir_corpus_pt.mjs
import { getPool } from '../src/db.js';
import { chatCompletion } from '../src/openrouter.js';
import { config } from '../src/config.js';

const FONTES = ['mercadona', 'lidl-fr'];
const LOTE = 40;
const pool = getPool();
const SYS = `Traduz nomes de produtos de supermercado (ES/FR) para PORTUGUÊS DO BRASIL (PT-BR).
Traduz as palavras descritivas; MARCAS e nomes próprios (Hacendado, Gorgonzola, Heinz, Milbona…) ficam iguais.
Mantém números/unidades. Devolve SÓ um objeto JSON {"<i>": "<traducao>"} para CADA item pelo seu número. Sem texto fora do JSON.`;
const parse = (s) => { try { return JSON.parse(String(s).replace(/```(json)?/gi, '').trim()); } catch { return null; } };

const ph = FONTES.map(() => '?').join(',');
const [pend] = await pool.query(
  `SELECT id, nome FROM catalogo_produto
    WHERE fonte IN (${ph}) AND (nome_pt IS NULL OR nome_pt='') AND nome IS NOT NULL AND nome<>'' ORDER BY id`, FONTES);
console.log('a traduzir:', pend.length);
let feitos = 0, mudados = 0;
for (let i = 0; i < pend.length; i += LOTE) {
  const lote = pend.slice(i, i + LOTE);
  const lista = lote.map((r, k) => `${k + 1}. ${r.nome}`).join('\n');
  let mapa = null;
  for (let tent = 0; tent < 2 && !mapa; tent++) {
    try {
      const out = await chatCompletion({
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: `Traduz:\n${lista}` }],
        model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, timeoutMs: 40000, contexto: 'traducao_corpus',
      });
      mapa = parse(out);
    } catch { /* retry */ }
  }
  if (mapa) {
    for (let k = 0; k < lote.length; k++) {
      const pt = mapa[String(k + 1)];
      if (pt && typeof pt === 'string' && pt.trim()) {
        await pool.query('UPDATE catalogo_produto SET nome_pt=? WHERE id=?', [pt.trim().slice(0, 255), lote[k].id]);
        mudados++;
      }
    }
  }
  feitos += lote.length;
  if (i % 400 === 0 || i + LOTE >= pend.length) process.stderr.write(`\r  ${feitos}/${pend.length} · nome_pt +${mudados}   `);
}
console.log(`\nCONCLUIDO: ${feitos} processados · nome_pt preenchido ${mudados}`);
await pool.end();

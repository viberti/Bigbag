// BACKFILL da nutrição+ingredientes do CONTINENTE nas linhas JÁ existentes do
// catálogo (o scrape inicial não as apanhou — vêm num separador AJAX). Para cada
// produto: fetch da página → tira o data-url do separador → fetch do fragmento →
// parser puro (src/ingest/nutricaoContinente.js) → UPDATE só das 3 colunas, via
// COALESCE (idempotente, nunca apaga o que já lá está). Aditivo e reversível.
//
// RESUMÍVEL por CURSOR (último id feito, em ficheiro) — cada linha é tocada 1×,
// mesmo as sem tabela (o cursor avança). Educado (delay) + circuit-breaker anti-bot.
//   sudo -u dev node --env-file=.env scripts/backfill_nutri_continente.mjs
//   DELAY=500 LIMITE=0 node scripts/backfill_nutri_continente.mjs   (LIMITE>0 = teste)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getPool } from '../src/db.js';
import { urlTabNutricional, extrairNutricaoContinente } from '../src/ingest/nutricaoContinente.js';

const UA = 'Mozilla/5.0 (compatible; BigbagBot/0.1; +catalogo pessoal)';
const DELAY = Number(process.env.DELAY || 450);
const LIMITE = Number(process.env.LIMITE || 0);
const CURSOR_FILE = new URL('../.nutri_continente_cursor', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { if (i === tentativas - 1) throw e; await sleep(700 * (i + 1)); }
  }
}

const lerCursor = () => { try { return Number(readFileSync(CURSOR_FILE, 'utf8').trim()) || 0; } catch { return 0; } };
const gravarCursor = (id) => { try { writeFileSync(CURSOR_FILE, String(id)); } catch { /* não-fatal */ } };

const pool = getPool();
let cursor = lerCursor();
console.log(`[nutri-continente] a retomar do id > ${cursor}${LIMITE ? ` (LIMITE ${LIMITE})` : ''}`);

const [linhas] = await pool.query(
  `SELECT id, url FROM catalogo_produto
   WHERE fonte='continente' AND url IS NOT NULL AND id > ?
   ORDER BY id ${LIMITE ? 'LIMIT ' + LIMITE : ''}`, [cursor]);
console.log(`[nutri-continente] ${linhas.length} produtos a processar.\n`);

let feitos = 0, comNut = 0, comIng = 0, semTab = 0, erro = 0, errosSeguidos = 0, t0 = Date.now();
for (const it of linhas) {
  if (errosSeguidos >= 25) { console.error(`[nutri-continente] ${errosSeguidos} erros seguidos — bloqueio anti-bot provável, a abortar (retoma depois).`); break; }
  try {
    const page = await fetchText(it.url);
    let nut = { nutricao: null, nutricao_base: null, ingredientes: null };
    if (page) {
      const ep = urlTabNutricional(page);
      if (ep) { await sleep(Math.round(DELAY / 2)); const frag = await fetchText(ep); if (frag) nut = extrairNutricaoContinente(frag); }
    }
    if (nut.nutricao || nut.ingredientes) {
      await pool.query(
        `UPDATE catalogo_produto SET
           nutricao=COALESCE(?, nutricao), nutricao_base=COALESCE(?, nutricao_base), ingredientes=COALESCE(?, ingredientes)
         WHERE id=?`,
        [nut.nutricao ? JSON.stringify(nut.nutricao) : null, nut.nutricao_base || null, nut.ingredientes || null, it.id]);
      if (nut.nutricao) comNut++; if (nut.ingredientes) comIng++;
    } else { semTab++; }
    errosSeguidos = 0;
  } catch (e) { erro++; errosSeguidos++; if (erro <= 5) console.error('  erro id', it.id, e.message); }
  cursor = it.id; feitos++;
  if (feitos % 50 === 0) {
    gravarCursor(cursor);
    const rps = (feitos / ((Date.now() - t0) / 1000)).toFixed(2);
    console.log(`  …${feitos}/${linhas.length} · nut ${comNut} · ing ${comIng} · sem-tab ${semTab} · erro ${erro} · ${rps}/s · cursor ${cursor}`);
  }
  await sleep(DELAY);
}
gravarCursor(cursor);
console.log(`\n✅ [nutri-continente] fim do lote: ${feitos} processados · ${comNut} c/ nutrição · ${comIng} c/ ingredientes · ${semTab} sem tabela · ${erro} erros. cursor=${cursor}`);
const [[c]] = await pool.query("SELECT SUM(nutricao IS NOT NULL) nut, SUM(ingredientes IS NOT NULL) ing FROM catalogo_produto WHERE fonte='continente'");
console.log(`[nutri-continente] TOTAL continente agora: ${c.nut} c/ nutrição · ${c.ing} c/ ingredientes.`);
await pool.end();
process.exit(0);

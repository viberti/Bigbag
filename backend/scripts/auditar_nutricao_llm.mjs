// Corre o AUDITOR LLM (migr. 096) sobre os casos SUSPEITOS de nutrição — a análise que precede a
// revisão humana. Seleciona suspeitos pelos sinais determinísticos (envelope de família C2 + sal=0
// em família salgada), pergunta ao LLM se a nutrição é plausível para o produto, e PERSISTE o
// veredicto. NÃO altera dados. Idempotente (salta os já auditados; --reaudit força).
//
//   sudo -u dev node --env-file=.env scripts/auditar_nutricao_llm.mjs --limite 50   # 1.º lote
//   sudo -u dev node --env-file=.env scripts/auditar_nutricao_llm.mjs               # todos os suspeitos
//   ... --reaudit   # re-audita mesmo os já feitos
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, parseJsonCol } from '../src/db.js';
import { familiaPorNome } from '../src/normaliza/familia.js';
import { nutricaoSuspeita } from '../src/normaliza/envelopeNutricao.js';
import { auditarNutricaoLLM } from '../src/ingest/auditarNutricaoLLM.js';
import { config } from '../src/config.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SALGADAS = new Set(['queijo', 'charcutaria', 'conservas_peixe', 'conservas_vegetais']);
const CONC = 4; // concorrência amiga do OpenRouter

const limIdx = process.argv.indexOf('--limite');
const LIMITE = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : 0;
const REAUDIT = process.argv.includes('--reaudit');

const pool = getPool();
try {
  const envelopes = JSON.parse(await readFile(path.join(DIR, '..', 'data', 'envelopes_nutricao.json'), 'utf8'));
  const jaFeitos = new Set();
  if (!REAUDIT) { const [a] = await pool.query('SELECT ean FROM nutricao_auditoria'); for (const x of a) jaFeitos.add(x.ean); }

  const [rows] = await pool.query('SELECT ean, nome, nutricao FROM base_local WHERE nutricao IS NOT NULL');
  const candidatos = [];
  for (const r of rows) {
    if (jaFeitos.has(r.ean)) continue;
    const n = parseJsonCol(r.nutricao);
    const familia = familiaPorNome(r.nome || '') || null;
    let motivo = null;
    if (nutricaoSuspeita(n, familia, envelopes).length) motivo = 'envelope_familia';
    else if (familia && SALGADAS.has(familia) && n && Number(n.sal) === 0) motivo = 'sal0_salgado';
    if (motivo) candidatos.push({ ean: r.ean, nome: r.nome, familia, nutricao: n, motivo });
  }
  const lote = LIMITE > 0 ? candidatos.slice(0, LIMITE) : candidatos;
  console.log(`[auditLLM] suspeitos: ${candidatos.length}${LIMITE ? ` (a auditar ${lote.length})` : ''} · modelo ${config.openrouter.modelExtracao}`);

  const cont = { ok: 0, erro: 0, incerto: 0, falhou: 0 };
  for (let i = 0; i < lote.length; i += CONC) {
    const grupo = lote.slice(i, i + CONC);
    await Promise.all(grupo.map(async (c) => {
      const v = await auditarNutricaoLLM(c);
      if (!v) { cont.falhou++; return; }
      cont[v.veredicto]++;
      await pool.query(
        `INSERT INTO nutricao_auditoria (ean,nome,familia,motivo,veredicto,campos,confianca,resumo,modelo)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE veredicto=VALUES(veredicto),campos=VALUES(campos),confianca=VALUES(confianca),resumo=VALUES(resumo),modelo=VALUES(modelo),criado_em=CURRENT_TIMESTAMP`,
        [c.ean, c.nome, c.familia, c.motivo, v.veredicto, JSON.stringify(v.campos), v.confianca, v.resumo, config.openrouter.modelExtracao],
      );
    }));
    if ((i + CONC) % 40 === 0) console.log(`  …${Math.min(i + CONC, lote.length)}/${lote.length}`);
  }
  console.log(`[auditLLM] feito: ok=${cont.ok} erro=${cont.erro} incerto=${cont.incerto} falhou=${cont.falhou}`);
  await pool.end(); process.exit(0);
} catch (e) { console.error(e.message); await pool.end().catch(() => {}); process.exit(1); }

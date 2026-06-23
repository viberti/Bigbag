// LUPA GLP-1 — diagnóstico read-only: AO VIVO (adaptadores de PRODUÇÃO) vs BANCO, por
// (EAN × fonte). NÃO escreve nada. Reutiliza precoEstoqueVtex / precoPanvelEan /
// precoNisseiEan / precoAraujoEan. RD/jsonld = SEM-ADAPTADOR-AO-VIVO → compara harvest.
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { aplicarProxy } from '../src/rede.js';
import { precoEstoqueVtex } from '../src/ingest/precoVivo.js';
import { precoPanvelEan } from '../src/ingest/precoPanvel.js';
import { precoNisseiEan } from '../src/ingest/precoNissei.js';
import { precoAraujoEan } from '../src/ingest/precoAraujo.js';
aplicarProxy(); // habilita o ProxyAgent p/ as fontes geo (DPSP), igual à produção

const pool = getPool();
const FONTES = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const forca = (nome) => { const m = String(nome || '').match(/(\d+(?:[.,]\d+)?)\s*mg\b/i); return m ? m[1].replace(',', '.') + 'mg' : '?'; };
const SENT = new Set([99999, 999999, 9999999]);

// grade = referência (Ozempic/Mounjaro) COM oferta + genéricos oficiais (0)
const [grade] = await pool.query(
  "SELECT DISTINCT m.ean, m.produto, m.dose_valor, m.dose_unidade FROM medicamento m JOIN catalogo_produto cp ON cp.ean=m.ean AND cp.preco>0 WHERE m.produto IN('OZEMPIC','MOUNJARO') ORDER BY m.produto, m.dose_valor");
console.log('GRADE (referência c/ oferta):', grade.map((g) => g.ean).join(','), '\n');

async function liveDe(f, ean) {
  const motor = f.motor || 'vtex';
  try {
    if (motor === 'vtex') return { ...(await precoEstoqueVtex(f.host, ean, { proxy: !!f.geo, timeout: 9000 })), _via: 'vtex' };
    if (motor === 'panvel') { const r = await precoPanvelEan(ean); return r && { existe: r.existe, preco: r.preco, preco_cond: r.preco_cond, nome: r.nome, _via: 'panvel' }; }
    if (motor === 'nissei') { const r = await precoNisseiEan(ean); return r && { existe: r.existe, preco: r.preco, nome: r.nome, _via: 'nissei' }; }
    if (motor === 'araujo') { const r = await precoAraujoEan(ean); return r && { existe: r.existe, preco: r.preco, preco_cond: r.preco_cond, nome: r.nome, _via: 'araujo' }; }
    return { _via: 'SEM-ADAPTADOR' }; // raiadrogasil / jsonld
  } catch (e) { return { _erro: e.message.slice(0, 30), _via: motor }; }
}

for (const g of grade) {
  console.log(`\n══ ${g.produto} ${g.ean} (dose ${g.dose_valor}${g.dose_unidade}) ══`);
  const [rows] = await pool.query('SELECT fonte, sku_fonte, preco, preco_cond, preco_cond_obs, nome FROM catalogo_produto WHERE ean=? AND fonte IN (' + FONTES.map(() => '?').join(',') + ')', [g.ean, ...FONTES.map((f) => f.fonte)]);
  const banco = new Map(rows.map((r) => [r.fonte, r]));
  for (const f of FONTES) {
    const b = banco.get(f.fonte);
    const live = await liveDe(f, g.ean);
    await sleep(220);
    const motor = f.motor || 'vtex';
    // status
    let st;
    if (live && live._via === 'SEM-ADAPTADOR') st = b ? 'SEM-ADAPTADOR(harvest)' : 'SEM-ADAPTADOR/sem-linha';
    else if (live && live._erro) st = 'ERRO-LIVE';
    else if ((!live || !live.existe) && !b) st = 'NÃO-VENDE';
    else if (live && live.existe && !b) st = 'DIVERGE(live-tem/banco-não)';
    else if ((!live || !live.existe) && b) st = 'DIVERGE(banco-tem/live-não)';
    else {
      const lp = live.preco, bp = b.preco == null ? null : Number(b.preco);
      const difPct = lp != null && bp ? Math.abs(lp - bp) / bp : null;
      st = (difPct == null || difPct < 0.02) ? 'MATCH' : 'DIVERGE(preço)';
      // condicional↔normal: o nosso preco casa com o NORMAL live? (não o promo)
      if (live.preco_cond != null && bp != null && Math.abs(bp - live.preco_cond) < 0.5 && Math.abs(bp - lp) > 1) st = 'DIVERGE(preco=condicional!)';
    }
    const sent = (b && SENT.has(Number(b.preco))) ? ' ⚠SENTINELA-NO-BANCO' : '';
    const fb = b ? forca(b.nome) : '-';
    const detalhe = [];
    if (b) detalhe.push(`banco:R$${b.preco}${b.preco_cond ? '/cond'+b.preco_cond : ''}`);
    if (live && live.existe) detalhe.push(`live:R$${live.preco}${live.preco_cond ? '/cond'+live.preco_cond : ''}${live.disponivel === false ? '/ESGOTADO' : ''}`);
    console.log(`  ${f.fonte.padEnd(17)}${st.padEnd(28)} força(banco)=${fb.padEnd(7)}${detalhe.join(' · ')}${sent}`);
  }
}
await closePool();
console.log('\n── FIM (read-only)');

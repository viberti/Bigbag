// LOTE: liga os produtos de catálogo SEM EAN (Pingo Doce por defeito) ao catálogo
// COM EAN, por imagem + metadados. Escreve em catalogo_match. Reentrante (salta os
// já processados, incl. falhas de download → 'sem_imagem', para não re-tentar).
//   sudo -u dev node --env-file=.env scripts/match_pd_lote.mjs [--fonte=pingodoce] [--n=0]
import { getPool } from '../src/db.js';
import { matchPorVetor } from '../src/normaliza/matchImagem.js';
import { melhorCandidato, decidirBanda } from '../src/normaliza/matchCatalogoMeta.js';

const INFER = process.env.INFER_URL || 'http://localhost:8900';
const FONTE = (process.argv.find((a) => a.startsWith('--fonte=')) || '').split('=')[1] || 'pingodoce';
const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1]) || 0;
const CHUNK = 48, EMBED = 16;
const pool = getPool();

const [pds] = await pool.query(
  `SELECT id, nome, marca, formato_valor fval, unidade_base ubase, imagem_url
     FROM catalogo_produto
    WHERE fonte=? AND imagem_url<>'' AND imagem_url IS NOT NULL
      AND id NOT IN (SELECT origem_id FROM catalogo_match)
    ORDER BY id ${N ? 'LIMIT ' + N : ''}`, [FONTE]);
console.log(`${FONTE}: ${pds.length} produtos por processar`);

const baixar = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch { return null; }
};

const inserir = async (rows) => {
  if (!rows.length) return;
  const ph = rows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
  await pool.query(
    `INSERT INTO catalogo_match (origem_id, origem_fonte, ean, cand_id, cand_fonte, score, marca_estado, peso_estado, nome_ov, banda)
     VALUES ${ph} ON DUPLICATE KEY UPDATE banda=VALUES(banda)`,
    rows.flat());
};

const cont = {};
const t0 = Date.now();
let feitos = 0;
for (let i = 0; i < pds.length; i += CHUNK) {
  const chunk = pds.slice(i, i + CHUNK);
  // download (paralelo controlado)
  const comImg = [];
  const semImg = [];
  for (let k = 0; k < chunk.length; k += 8) {
    const sub = chunk.slice(k, k + 8);
    const b = await Promise.all(sub.map((x) => baixar(x.imagem_url)));
    sub.forEach((x, j) => (b[j] ? comImg.push({ ...x, b64: b[j] }) : semImg.push(x)));
  }
  // embed + match
  const avaliados = [];
  for (let k = 0; k < comImg.length; k += EMBED) {
    const sub = comImg.slice(k, k + EMBED);
    let d; try { d = await (await fetch(`${INFER}/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b64: sub.map((x) => x.b64) }) })).json(); } catch { d = { itens: [] }; }
    for (let j = 0; j < sub.length; j++) {
      const vec = d.itens?.[j]?.vec;
      avaliados.push({ pd: sub[j], cands: vec ? await matchPorVetor(vec, { k: 5 }) : [] });
    }
  }
  // metadados dos candidatos do chunk
  const ids = [...new Set(avaliados.flatMap((a) => a.cands.map((c) => c.id)))];
  const meta = new Map();
  if (ids.length) {
    const [rows] = await pool.query(`SELECT id, nome, marca, formato_valor fval, unidade_base ubase, fonte FROM catalogo_produto WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const x of rows) meta.set(x.id, x);
  }
  // decidir + montar linhas
  const linhas = [];
  for (const x of semImg) { linhas.push([x.id, FONTE, null, null, null, null, null, null, null, 'sem_imagem']); cont.sem_imagem = (cont.sem_imagem || 0) + 1; }
  for (const { pd, cands } of avaliados) {
    const best = melhorCandidato(pd, cands, meta);
    const banda = decidirBanda(best);
    cont[banda] = (cont[banda] || 0) + 1;
    if (best && banda !== 'sem_match') {
      linhas.push([pd.id, FONTE, best.cand.ean || null, best.cand.id, best.cand.fonte || best.m.fonte || null, best.score, best.marca, best.peso, best.ov, banda]);
    } else {
      linhas.push([pd.id, FONTE, null, null, null, best ? best.score : null, null, null, null, 'sem_match']);
    }
  }
  await inserir(linhas);
  feitos += chunk.length;
  process.stderr.write(`\r  ${feitos}/${pds.length} · ${(feitos / ((Date.now() - t0) / 1000)).toFixed(1)}/s · ${JSON.stringify(cont)}   `);
}
console.log(`\nconcluído: ${feitos} processados`);
console.log('distribuição:', JSON.stringify(cont, null, 0));
await pool.end();

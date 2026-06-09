// Reprocessa as FOTOS já guardadas dos produtos (produto_foto) com o VLM e enriquece
// a produto_ean: PREENCHE marca/nome/volume em falta, LIMPA o ruído do volume
// (símbolo ℮ → "cle"/"mle"→cl/ml, espaçamento) e refresca o vlm_json. NÃO sobrescreve
// valores bons; assinala (⚠) quando o VLM difere do guardado, para revisão humana.
// Útil p/ o que o OFF não tem (cervejas, não-alimentares) — a foto tem a verdade.
//   node --env-file=.env scripts/reprocessar_fotos.mjs [--dry] [--limite=N]
import { readFile } from 'node:fs/promises';
import { getPool } from '../src/db.js';
import { extrairProdutoFotos } from '../src/ingest/produto.js';

const DRY = process.argv.includes('--dry');
const limArg = process.argv.find((a) => a.startsWith('--limite='));
const LIMITE = limArg ? Number(limArg.split('=')[1]) : Infinity;

// Normaliza um volume/peso lido do rótulo: tira o ℮ da UE, junta "cl e"/"cle" → cl,
// espaça antes da unidade. "25 cle" → "25 cl"; "21cl" → "21 cl".
function limparVolume(q) {
  if (!q) return null;
  let s = String(q).replace(/℮/g, ' ');
  s = s.replace(/\bc\s*l\s*e\b/gi, 'cl').replace(/\bm\s*l\s*e\b/gi, 'ml');
  s = s.replace(/(\d)\s*(cl|ml|kg|g|l)\b/gi, (m, d, u) => `${d} ${u.toLowerCase()}`);
  return s.replace(/\s+/g, ' ').trim() || null;
}

const pool = getPool();
const [fotos] = await pool.query(
  'SELECT item_id, ean, ficheiro, mime, ordem FROM produto_foto WHERE item_id IS NOT NULL ORDER BY item_id, ordem',
);
const grupos = new Map();
for (const f of fotos) {
  if (!grupos.has(f.item_id)) grupos.set(f.item_id, { item_id: f.item_id, ean: null, fotos: [] });
  const g = grupos.get(f.item_id);
  g.fotos.push(f);
  if (!g.ean && f.ean) g.ean = f.ean;
}

let n = 0, mudados = 0, custo = 0, erros = 0;
for (const g of grupos.values()) {
  if (n >= LIMITE) break;
  n++;
  const payload = [];
  for (const f of g.fotos) {
    try { payload.push({ base64: (await readFile(f.ficheiro)).toString('base64'), mime: f.mime || 'image/jpeg' }); } catch {}
  }
  if (!payload.length) { continue; }
  let dados;
  try { const r = await extrairProdutoFotos(payload); dados = r.dados; custo += r.custo || 0; }
  catch (e) { erros++; console.log(`item ${g.item_id}: ERRO VLM ${e.message}`); continue; }

  const [[pe]] = g.ean
    ? await pool.query('SELECT id, nome, marca, quantidade, off_json FROM produto_ean WHERE ean=? ORDER BY id LIMIT 1', [g.ean])
    : await pool.query('SELECT id, nome, marca, quantidade, off_json FROM produto_ean WHERE item_id=? AND ean IS NULL ORDER BY id LIMIT 1', [g.item_id]);
  if (!pe) { console.log(`item ${g.item_id} [${g.ean || '-'}]: sem produto_ean`); continue; }

  const up = {}; const notas = [];
  // volume: limpa o atual (ruído ℮); se vazio, usa o do VLM
  const qtdLimpa = limparVolume(pe.quantidade || dados.quantidade);
  if (qtdLimpa && qtdLimpa !== pe.quantidade) { up.quantidade = qtdLimpa; notas.push(`vol "${pe.quantidade || '∅'}"→"${qtdLimpa}"`); }
  if (dados.marca && !pe.marca) { up.marca = dados.marca; notas.push(`+marca "${dados.marca}"`); }
  if (dados.nome && !pe.nome) { up.nome = dados.nome; notas.push(`+nome "${dados.nome}"`); }
  // diferenças informativas (NÃO sobrescreve) — para o operador decidir
  const volVlm = limparVolume(dados.quantidade), volAtual = limparVolume(pe.quantidade);
  if (volVlm && volAtual && volVlm !== volAtual && !up.quantidade) notas.push(`⚠ VLM vol "${volVlm}" ≠ "${volAtual}"`);
  if (dados.marca && pe.marca && !pe.marca.toLowerCase().includes(dados.marca.toLowerCase().split(' ')[0])) notas.push(`⚠ VLM marca "${dados.marca}" ≠ "${pe.marca}"`);

  if (notas.length) {
    mudados++;
    console.log(`item ${g.item_id} [${g.ean || '-'}] "${pe.nome || dados.nome}": ${notas.join(' · ')}`);
  }
  if (!DRY) {
    up.vlm_json = JSON.stringify(dados);
    up.fonte = pe.off_json ? 'ambos' : 'vlm';
    const sets = Object.keys(up).map((k) => `${k}=?`).join(', ');
    await pool.query(`UPDATE produto_ean SET ${sets} WHERE id=?`, [...Object.values(up), pe.id]);
  }
}
console.log(`\n${DRY ? '[DRY] ' : ''}${n} grupos · ${mudados} com alterações · ${erros} erros · custo ~$${custo.toFixed(4)}`);
process.exit(0);

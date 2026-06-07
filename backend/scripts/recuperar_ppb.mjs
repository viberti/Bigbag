// Recupera o €/kg (preco_por_base) de itens A PESO em notas de IMAGEM onde o
// talão IMPRIME o €/kg mas a extração antiga o perdeu (causa 2 da lacuna).
// Re-extrai cada fatura-alvo com o esquema novo (peso_kg/preco_base_impresso),
// casa os itens por (descrição limpa, valor) e atualiza SÓ os que têm ppb NULL.
// NÃO inventa: lojas que não imprimem €/kg (causa 1) ficam como estão.
//
// Uso:  node --env-file=.env scripts/recuperar_ppb.mjs          (preview: conta alvos)
//       node --env-file=.env scripts/recuperar_ppb.mjs --apply  (re-extrai e atualiza)
import { readFile } from 'node:fs/promises';
import { getPool } from '../src/db.js';
import { extrairFatura } from '../src/ingest/extract.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';
import { limparDescricao } from '../src/normaliza/mestre.js';

const APPLY = process.argv.includes('--apply');
const db = getPool();
const k = (s) => limparDescricao(String(s || '')).toLowerCase();
const mimeDe = (f) => (f.endsWith('.png') ? 'image/png' : f.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

const [fats] = await db.query(
  `SELECT f.id, f.ficheiro_original AS fich, l.nome AS loja
     FROM fatura f JOIN item i ON i.fatura_id=f.id JOIN loja l ON l.id=f.loja_id
     LEFT JOIN sku_normalizado s ON s.id=i.sku_id
    WHERE f.metodo_extracao='vlm' AND f.ficheiro_original IS NOT NULL
      AND i.preco_por_base IS NULL AND i.is_non_product=0 AND s.unidade_base IN ('kg','L')
    GROUP BY f.id`);
console.log(`${APPLY ? 'APLICAR' : 'PREVIEW'} · faturas-alvo: ${fats.length}\n`);
if (!APPLY) { console.log('(corre com --apply para re-extrair e atualizar)'); await db.end(); process.exit(0); }

let recuperados = 0, semEurKg = 0, naoCasou = 0, erros = 0;
for (const f of fats) {
  // itens existentes desta fatura sem ppb
  const [itens] = await db.query(
    'SELECT id, descricao_original AS d, preco_liquido AS pl, quantidade AS q FROM item WHERE fatura_id=? AND preco_por_base IS NULL AND is_non_product=0',
    [f.id],
  );
  if (!itens.length) continue;
  let dados;
  try {
    const buf = await readFile(f.fich);
    dados = await extrairFatura({ imageBase64: buf.toString('base64'), mime: mimeDe(f.fich) });
  } catch (e) {
    erros++; console.log(`#${f.id} [${f.loja}] ERRO re-extração: ${e.message}`); continue;
  }
  // mapa desc-limpa → [itens re-extraídos com peso]
  const porDesc = new Map();
  for (const r of dados.itens || []) {
    if (r.is_non_product) continue;
    const key = k(r.descricao_original);
    (porDesc.get(key) || porDesc.set(key, []).get(key)).push(r);
  }
  for (const it of itens) {
    const cands = porDesc.get(k(it.d)) || [];
    if (!cands.length) { naoCasou++; continue; }
    // melhor candidato por proximidade de valor
    const r = cands.sort((a, b) => Math.abs(Number(a.valor) - Number(it.pl)) - Math.abs(Number(b.valor) - Number(it.pl)))[0];
    if (!r.linha_peso) { semEurKg++; continue; } // talão não imprime €/kg (causa 1) → não inventa
    const fmt = extrairFormato([it.d, r.linha_peso].filter(Boolean).join(' '));
    const ppb = precoPorBase({ preco_liquido: it.pl, quantidade: it.q }, fmt);
    if (!(Number(ppb) > 0)) { semEurKg++; continue; }
    await db.query('UPDATE item SET linha_peso=?, preco_por_base=? WHERE id=?', [r.linha_peso, ppb, it.id]);
    recuperados++;
    console.log(`#${f.id} [${f.loja}] "${it.d}" → €/kg ${ppb} (peso ${r.linha_peso})`);
  }
}
console.log(`\n=== ${recuperados} itens recuperados · ${semEurKg} sem €/kg no talão (causa 1) · ${naoCasou} não casaram · ${erros} erros ===`);
await db.end();
process.exit(0);

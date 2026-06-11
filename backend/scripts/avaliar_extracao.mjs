// AVALIAÇÃO COMPLETA e NÃO-DESTRUTIVA: re-lê cada talão guardado com o pipeline
// ATUAL (VLM/texto + loop de auto-correção) e compara, campo a campo, com o que
// está na BD (o processo ANTERIOR). NÃO escreve nada — só relata as diferenças.
//   node scripts/avaliar_extracao.mjs            ← só talões de imagem (25)
//   node scripts/avaliar_extracao.mjs --all      ← imagem + PDF
//   node scripts/avaliar_extracao.mjs --fatura 41
import { readFile } from 'node:fs/promises';
import { getPool } from '../src/db.js';
import { extrairFatura, extrairFaturaDeTexto } from '../src/ingest/extract.js';
import { extrairTextoPdf } from '../src/ingest/pdf.js';
import { preProcessarImagem } from '../src/ingest/imagem.js';
import { distribuirDesconto, validarLinhas, pistaCirurgica } from '../src/ingest/reconcile.js';
import { config } from '../src/config.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const args = process.argv.slice(2);
const SO_FATURA = args.includes('--fatura') ? Number(args[args.indexOf('--fatura') + 1]) : null;
const INCLUI_PDF = args.includes('--all');

// Re-extração com o MESMO loop de auto-correção da ingestão/reprocesso (sem escrever).
async function reextrair(f) {
  const buf = await readFile(f.ficheiro_original);
  const ehPdf = f.metodo_extracao === 'ocr_llm' || /\.pdf$/i.test(f.ficheiro_original);
  let ler;
  if (ehPdf) { const texto = await extrairTextoPdf(buf); ler = (c) => extrairFaturaDeTexto(texto, { correcao: c }); }
  else { const img = await preProcessarImagem(buf); const b64 = img.buffer.toString('base64'); ler = (c) => extrairFatura({ imageBase64: b64, mime: img.mime, correcao: c }); }
  const recon = (d) => distribuirDesconto(d.itens, { descontoGlobal: num(d.desconto_global) || 0, totalImpresso: d.total_impresso, iva: num(d.iva) || 0 });
  const probl = (r, li) => Math.abs(r.discrepancia) + (li?.length || 0);
  let dados = await ler(), rec = recon(dados), li = validarLinhas(dados.itens);
  for (let i = 0; i < config.openrouter.maxCorrecoes && (!rec.extracaoBate || li.length) && dados.total_impresso != null; i++) {
    const hint = `A soma dos itens deu ${rec.subtotal} mas o total impresso é ${dados.total_impresso} (diferença ${rec.discrepancia}).${pistaCirurgica(rec.itens, rec.discrepancia)} Devolve o JSON corrigido.`;
    let d2, r2, l2; try { d2 = await ler(hint); r2 = recon(d2); l2 = validarLinhas(d2.itens); } catch { break; }
    if (probl(r2, l2) < probl(rec, li)) { dados = d2; rec = r2; li = l2; } else break;
  }
  return { itens: rec.itens, total: num(dados.total_impresso), discrepancia: rec.discrepancia };
}

// Alinha itens VELHO↔NOVO por preço (a âncora mais estável) + semelhança de nome.
function alinhar(velho, novo) {
  const usados = new Set(), pares = [];
  for (const n of novo) {
    let melhor = -1, mDist = 1e9;
    for (let i = 0; i < velho.length; i++) {
      if (usados.has(i)) continue;
      const dp = Math.abs(Number(velho[i].preco_liquido) - Number(n.preco_liquido));
      if (dp < mDist && dp <= 0.02) { mDist = dp; melhor = i; }
    }
    if (melhor >= 0) { usados.add(melhor); pares.push([velho[melhor], n]); }
    else pares.push([null, n]); // item NOVO sem par (ganho)
  }
  for (let i = 0; i < velho.length; i++) if (!usados.has(i)) pares.push([velho[i], null]); // PERDIDO
  return pares;
}

const pool = getPool();
let where = "f.ficheiro_original IS NOT NULL";
if (!INCLUI_PDF) where += " AND f.ficheiro_original NOT LIKE '%.pdf'";
if (SO_FATURA) where = `f.id = ${SO_FATURA}`;
const [faturas] = await pool.query(
  `SELECT f.id, f.ficheiro_original, f.metodo_extracao, l.cadeia, DATE(f.data_compra) dia FROM fatura f JOIN loja l ON l.id=f.loja_id WHERE ${where} ORDER BY f.id`);

console.log(`Avaliação NÃO-destrutiva: ${faturas.length} talões (anterior na BD × re-leitura atual)\n`);
let agg = { faturas: 0, itensVelho: 0, itensNovo: 0, nomeDif: 0, qtdDif: 0, precoDif: 0, ganhos: 0, perdidos: 0, comDif: 0, erros: 0 };
const exemplos = [];
for (const f of faturas) {
  let novo;
  try { novo = await reextrair(f); } catch (e) { console.log(`  fatura ${f.id}: ERRO re-leitura — ${e.message}`); agg.erros++; continue; }
  const [velho] = await pool.query('SELECT descricao_original, quantidade, preco_liquido FROM item WHERE fatura_id=? ORDER BY id', [f.id]);
  agg.faturas++; agg.itensVelho += velho.length; agg.itensNovo += novo.itens.length;
  const pares = alinhar(velho, novo.itens);
  let dif = 0;
  for (const [v, n] of pares) {
    if (!v) { agg.ganhos++; dif++; if (exemplos.length < 40) exemplos.push(`  f${f.id} GANHOU item: "${n.descricao_original}" (€${n.preco_liquido})`); continue; }
    if (!n) { agg.perdidos++; dif++; if (exemplos.length < 40) exemplos.push(`  f${f.id} PERDEU item: "${v.descricao_original}" (€${v.preco_liquido})`); continue; }
    if (norm(v.descricao_original) !== norm(n.descricao_original)) { agg.nomeDif++; dif++; if (exemplos.length < 40) exemplos.push(`  f${f.id} NOME: "${v.descricao_original}" → "${n.descricao_original}"`); }
    if ((num(v.quantidade) || 1) !== (num(n.quantidade) || 1)) { agg.qtdDif++; dif++; }
    if (Math.abs(Number(v.preco_liquido) - Number(n.preco_liquido)) > 0.02) agg.precoDif++;
  }
  if (dif) agg.comDif++;
  console.log(`  f${f.id} (${f.cadeia} ${f.dia.toISOString().slice(0, 10)}): velho ${velho.length} / novo ${novo.itens.length} itens · ${dif} diferença(s)`);
}

console.log(`\n=== RESUMO (processo anterior × atual) ===`);
console.log(`Talões avaliados: ${agg.faturas} (${agg.erros} com erro de re-leitura)`);
console.log(`Itens: ${agg.itensVelho} (anterior) vs ${agg.itensNovo} (atual)`);
console.log(`Talões com alguma diferença: ${agg.comDif}/${agg.faturas}`);
console.log(`  · nomes diferentes:   ${agg.nomeDif}`);
console.log(`  · quantidades difer.: ${agg.qtdDif}`);
console.log(`  · preços difer.:      ${agg.precoDif}`);
console.log(`  · itens ganhos (novo lê a mais): ${agg.ganhos}`);
console.log(`  · itens perdidos (novo lê a menos): ${agg.perdidos}`);
if (exemplos.length) { console.log(`\nExemplos de diferença:`); for (const e of exemplos) console.log(e); }
process.exit(0);

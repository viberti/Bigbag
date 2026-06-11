// PROCESSO ANTIGO (leitura única) × NOVO (leitura única + 2.ª opinião).
// Para cada talão de imagem: faz UMA leitura fresca (= antigo) e depois corre a
// 2.ª opinião sobre os nomes suspeitos dessa leitura (= novo). Conta os nomes que
// a 2.ª opinião CORRIGE — cada correção é um erro do processo antigo que o novo
// apanha (confirmado pelo catálogo; voto a 3). NÃO escreve nada na BD.
//   node scripts/exp_novo_vs_antigo.mjs [N]   ← N talões (default 6, p/ ser rápido)
import { readFile } from 'node:fs/promises';
import { getPool } from '../src/db.js';
import { extrairFatura } from '../src/ingest/extract.js';
import { preProcessarImagem } from '../src/ingest/imagem.js';
import { distribuirDesconto } from '../src/ingest/reconcile.js';
import { segundaOpiniao, decidirNome } from '../src/ingest/verificarNomes.js';
import { buscarCatalogo } from '../src/normaliza/resolverProduto.js';

const N = Number(process.argv[2]) || 6;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const pool = getPool();

// suspeito: nome nunca visto noutras notas + sem produto_nome + catálogo não reconhece
async function ehSuspeito(desc, cadeia) {
  const [[a]] = await pool.query('SELECT COUNT(*) n FROM item WHERE descricao_original = ?', [desc]);
  if (a.n > 0) return false; // visto na BD → consistente (a leitura fresca pode diferir, mas a forma é conhecida)
  const [[b]] = await pool.query('SELECT COUNT(*) n FROM produto_nome WHERE nome = ?', [desc]);
  if (b.n > 0) return false;
  try { if (await buscarCatalogo(pool, desc, { cadeia, limiar: 0.55 })) return false; } catch { /* */ }
  return true;
}

const [faturas] = await pool.query(
  `SELECT f.id, f.ficheiro_original, l.cadeia FROM fatura f JOIN loja l ON l.id=f.loja_id
    WHERE f.metodo_extracao='vlm' AND f.ficheiro_original NOT LIKE '%.pdf' ORDER BY f.id DESC LIMIT ?`, [N]);

let totItens = 0, totSusp = 0, totCorr = 0, totDuv = 0;
const corrigidos = [];
console.log(`PROCESSO ANTIGO (1 leitura) × NOVO (+2.ª opinião) — ${faturas.length} talões\n`);
for (const f of faturas) {
  let dados;
  try {
    const img = await preProcessarImagem(await readFile(f.ficheiro_original));
    dados = await extrairFatura({ imageBase64: img.buffer.toString('base64'), mime: img.mime });
  } catch (e) { console.log(`  f${f.id}: erro leitura — ${e.message}`); continue; }
  const itens = distribuirDesconto(dados.itens, { descontoGlobal: num(dados.desconto_global) || 0, totalImpresso: dados.total_impresso, iva: num(dados.iva) || 0 }).itens
    .filter((it) => !it.is_non_product);
  totItens += itens.length;
  // 1) ANTIGO: a leitura fresca, tal e qual.
  // 2) NOVO: detetar suspeitos e pedir 2.ª opinião.
  const suspeitos = [];
  for (const it of itens) if (await ehSuspeito(it.descricao_original, f.cadeia)) suspeitos.push(it);
  totSusp += suspeitos.length;
  let nomes = [];
  if (suspeitos.length) { try { nomes = await segundaOpiniao(f.ficheiro_original, suspeitos); } catch { /* */ } }
  let corr = 0, duv = 0;
  for (let i = 0; i < suspeitos.length; i++) {
    const lido = suspeitos[i].descricao_original;
    const opiniao = nomes[i] || null;
    let scoreOp = 0;
    if (opiniao && norm(opiniao) !== norm(lido)) {
      try { scoreOp = (await buscarCatalogo(pool, opiniao, { cadeia: f.cadeia, limiar: 0.55 }))?.score || 0; } catch { /* */ }
    }
    const d = decidirNome({ lido, opiniao, scoreLido: 0, scoreOpiniao: scoreOp });
    if (d.resultado === 'corrigido') { corr++; corrigidos.push(`f${f.id}: ANTIGO leu "${lido}" → NOVO corrige "${d.nome}"`); }
    else if (d.resultado === 'duvida' && opiniao && norm(opiniao) !== norm(lido)) duv++;
  }
  totCorr += corr; totDuv += duv;
  console.log(`  f${f.id} (${f.cadeia}): ${itens.length} itens · ${suspeitos.length} suspeitos · ${corr} corrigidos · ${duv} dúvidas`);
}

console.log(`\n=== RESUMO: quanto o processo NOVO melhora o ANTIGO ===`);
console.log(`Itens lidos: ${totItens} · suspeitos: ${totSusp}`);
console.log(`Erros de nome do ANTIGO que o NOVO CORRIGE (catálogo confirma): ${totCorr}`);
console.log(`Divergências que ficam em dúvida (novo não piora — mantém o lido): ${totDuv}`);
console.log(`Taxa de correção: ${totItens ? (100 * totCorr / totItens).toFixed(1) : 0}% dos itens`);
if (corrigidos.length) { console.log(`\nCorreções:`); for (const c of corrigidos) console.log('  ' + c); }
process.exit(0);

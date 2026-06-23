// CLUSTER 2 — FASE 3 SIMULAÇÃO (read-only, NÃO cria tabela nem altera query). Usa o mapa
// curado PROPOSTO em memória p/ mostrar o ANTES (query atual: substancia+dose_valor+forma) vs
// DEPOIS (substancia+forma+FORÇA_EFETIVA+papel; preço/dose com QTD_EFETIVA). Prova (a)-(d).
import { getPool, closePool } from '../src/db.js';
const pool = getPool();

// valores CURADOS propostos (FASE 2) — força autoritativa do STEP 6 da lupa + apresentacao oficial
const CURADO = {
  '7897705202548': { forca: 0.25, un: 'mg', papel: 'inicio', qtd: null },      // Ozempic starter 0,25/0,5
  '7897705202586': { forca: 1, un: 'mg', papel: 'manutencao', qtd: null },     // Ozempic 1mg
  '7896382709111': { forca: 2.5, un: 'mg', papel: 'manutencao', qtd: 4 },      // Mounjaro 2,5mg (4 SER PREENC)
  '7896382709135': { forca: 5, un: 'mg', papel: 'manutencao', qtd: 4 },
  '7896382709159': { forca: 7.5, un: 'mg', papel: 'manutencao', qtd: 4 },
  '7896382709173': { forca: 10, un: 'mg', papel: 'manutencao', qtd: 4 },
  '7896382709197': { forca: 12.5, un: 'mg', papel: 'manutencao', qtd: 4 },
  '7896382709210': { forca: 15, un: 'mg', papel: 'manutencao', qtd: 4 },
};
const forcaEf = (m) => { const c = CURADO[m.ean]; return c ? `${c.forca}${c.un}` : `${m.dose_valor}${m.dose_unidade}`; };
const papelDe = (m) => (CURADO[m.ean] ? CURADO[m.ean].papel : 'manutencao');

const [meds] = await pool.query(`
  SELECT m.ean, m.produto, m.substancia, m.dose_valor, m.dose_unidade, m.forma, m.qtd_embalagem,
         MIN(cp.preco) menor
    FROM medicamento m JOIN catalogo_produto cp ON cp.ean=m.ean AND cp.preco>0 AND cp.moeda='BRL'
   WHERE m.substancia IN('SEMAGLUTIDA','TIRZEPATIDA') GROUP BY m.ean`);
const byEan = new Map(meds.map((m) => [m.ean, m]));

function buckets(refEan) {
  const r = byEan.get(refEan); if (!r) return console.log(`  ${refEan}: sem oferta`);
  const antes = meds.filter((m) => m.substancia === r.substancia && Number(m.dose_valor) === Number(r.dose_valor) && m.dose_unidade === r.dose_unidade && m.forma === r.forma);
  const rForca = forcaEf(r), rPapel = papelDe(r);
  const depois = meds.filter((m) => m.substancia === r.substancia && m.forma === r.forma && forcaEf(m) === rForca && papelDe(m) === rPapel);
  const ppd = (m, q) => { const qq = Number(q); return qq > 0 ? (Number(m.menor) / qq).toFixed(2) : 'NULL(÷0)'; };
  console.log(`\n── ${r.produto} ${refEan}  (dose_valor=${r.dose_valor}${r.dose_unidade} · força_ef=${rForca} · papel=${rPapel})`);
  console.log(`  ANTES (substancia+dose_valor+forma) — ${antes.length} no balde:`);
  console.log('    ' + antes.map((m) => `${m.produto}/${forcaEf(m)}`).join(', '));
  console.log(`  DEPOIS (substancia+forma+força_ef+papel) — ${depois.length} no balde:`);
  console.log('    ' + depois.map((m) => `${m.produto}/${forcaEf(m)}/${papelDe(m)}`).join(', '));
  console.log(`  preço/dose ${r.produto}: ANTES ${ppd(r, r.qtd_embalagem)} (qtd=${r.qtd_embalagem}) → DEPOIS ${ppd(r, CURADO[refEan]?.qtd ?? r.qtd_embalagem)} (qtd_ef=${CURADO[refEan]?.qtd ?? r.qtd_embalagem})`);
}

console.log('═══ FASE 3 — SIMULAÇÃO antes/depois (read-only) ═══');
buckets('7897705202586'); // (a) Ozempic 1mg
buckets('7897705202548'); // (b) starter
buckets('7896382709111'); // (c)+(d) Mounjaro 2,5mg
buckets('7896382709135'); // Mounjaro 5mg (confirmar baldes separados)
await closePool();

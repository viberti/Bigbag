// SEED de SONDAS DE CALIBRAÇÃO do motor de alertas (Trilho A). DADO DE TESTE — não são usuários
// reais. Planta um conjunto controlado de monitores SEUS para observar o motor disparar/não-disparar
// sobre dados reais e calibrar os parâmetros 8%/R$80 com scripts/relatorio_alertas.mjs.
//
// COMO USAR:
//   1. node --env-file=.env scripts/seed_sondas_calibracao.mjs            # planta as sondas (limpa+recria)
//   2. espere 1+ ciclo do motor (cron 4/4h) OU rode à mão:
//        node --env-file=.env scripts/avaliar_alertas.mjs
//   3. node --env-file=.env scripts/relatorio_alertas.mjs                 # leia disparos vs. esperado
//   4. para recomeçar limpo: node --env-file=.env scripts/seed_sondas_calibracao.mjs --reset
//      (e seed de novo). O --reset apaga TUDO do utilizador de sondagem por cascata.
//
// MARCAÇÃO DO TIPO: o tipo (ALTA/COLADA/MEDIA) fica no próprio `utilizador` — subendereços
//   calibracao+alta@ / calibracao+colada@ / calibracao+media@ (uma só identidade, prefixo
//   'calibracao'). Assim o tipo é visível direto no relatório (que imprime `utilizador`), e o
//   UNIQUE(utilizador, ean) permite as 3 sondas no MESMO EAN (utilizador distinto por tipo).
//   baseline_sugerido guarda a mediana lida; baseline_origem = 'aceito_sugerido' (MEDIA, aceita a
//   sugestão) ou 'declarado' (ALTA/COLADA, desvia). Inserção direta em usuario_monitor REPLICANDO
//   exatamente o que o POST /monitor-usuario faz (mesma mediana, mesmos campos).
//
// LIMITES: só cria/limpa sondas do utilizador 'calibracao%@hal9klabs.com'. NUNCA toca outro
// utilizador, nem motor/endpoints/coleta/schema. Reversível por cascata (FK ON DELETE CASCADE).
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';

const DOMINIO = 'hal9klabs.com';
const PREFIXO = 'calibracao';                       // marcador inconfundível de sonda
const emailTipo = (t) => `${PREFIXO}+${t}@${DOMINIO}`;
const FARM = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8')).map((f) => f.fonte);
const inFarm = '(' + FARM.map(() => '?').join(',') + ')';

const pool = getPool();
const reset = process.argv.includes('--reset');

// Preços de mercado (tabela, com estoque) — MESMA lógica do /monitor-usuario/sugestao: snapshot
// denso stock-filtrado primeiro; cai no catálogo se o denso ainda não cobre o EAN. Ordenado asc.
async function precosMercado(ean) {
  const [snaps] = await pool.query(
    `SELECT t.preco FROM medicamento_monitor_hist t
       JOIN (SELECT fonte, MAX(capturado_em) mx FROM medicamento_monitor_hist WHERE ean = ? GROUP BY fonte) g
         ON g.fonte = t.fonte AND g.mx = t.capturado_em
      WHERE t.ean = ? AND t.preco > 0 AND t.disponivel = 1`, [ean, ean]);
  let arr = snaps.map((s) => Number(s.preco));
  if (arr.length < 2) {
    const [cat] = await pool.query(
      `SELECT preco FROM catalogo_produto WHERE ean = ? AND preco > 0 AND moeda = 'BRL' AND fonte IN ${inFarm}`, [ean, ...FARM]);
    if (cat.length >= arr.length) arr = cat.map((r) => Number(r.preco));
  }
  arr.sort((a, b) => a - b);
  return arr;
}
const mediana = (arr) => { if (!arr.length) return null; const n = arr.length, k = Math.floor(n / 2); return n % 2 ? arr[k] : Math.round(((arr[k - 1] + arr[k]) / 2) * 100) / 100; };
// MESMA regra do motor: dispara se menor <= baseline*(1-limiar/100) E (baseline-menor) >= piso.
const dispara = (baseline, menor, limiar = 8, piso = 80) => menor != null && menor <= baseline * (1 - limiar / 100) && (baseline - menor) >= piso;

// Remove TUDO do utilizador de sondagem por cascata (usuario_monitor + alerta_log ON DELETE CASCADE).
async function limparSondas() {
  const [mAntes] = await pool.query(`SELECT COUNT(*) n FROM usuario_monitor WHERE utilizador LIKE '${PREFIXO}%'`);
  const [aAntes] = await pool.query(`SELECT COUNT(*) n FROM alerta_log WHERE utilizador LIKE '${PREFIXO}%'`);
  const [r] = await pool.query(`DELETE FROM usuario WHERE email LIKE '${PREFIXO}%@${DOMINIO}'`);
  return { usuarios: r.affectedRows, monitores: mAntes[0].n, alertas: aAntes[0].n };
}

if (reset) {
  const c = await limparSondas();
  // confirma que só tocou sondas: nenhum monitor/alerta com prefixo deve restar; reais intactos
  const [[m]] = await pool.query(`SELECT COUNT(*) n FROM usuario_monitor WHERE utilizador LIKE '${PREFIXO}%'`);
  const [[real]] = await pool.query(`SELECT COUNT(*) n FROM usuario_monitor WHERE utilizador NOT LIKE '${PREFIXO}%'`);
  console.log(`── --reset ── removidos por cascata: ${c.usuarios} usuario · ${c.monitores} monitores · ${c.alertas} alertas`);
  console.log(`   sondas restantes: ${m.n} (esperado 0) · monitores NÃO-sonda intactos: ${real.n}`);
  await closePool();
  process.exit(0);
}

// ── SEED (idempotente: limpa as sondas anteriores e recria) ──
console.log('── seed sondas de calibração (DADO DE TESTE) ──');
const limpo = await limparSondas();
if (limpo.monitores) console.log(`(limpou ${limpo.monitores} sondas anteriores + ${limpo.alertas} alertas)`);

// Apresentações-sonda (EANs reais do catálogo).
const APRES = [
  { ean: '7897705202586', nome: 'Ozempic 1mg' },
  { ean: '7896382709135', nome: 'Mounjaro 5mg' },
  { ean: '7896004796581', nome: 'Ozivy 1mg' },
];
// Liraglutida (ex.: Saxenda) — exercita a PONTE (EAN não-semeado entra no denso) SE houver oferta.
const [[lir]] = await pool.query(
  `SELECT m.ean, m.produto FROM medicamento m
    WHERE m.substancia LIKE '%LIRAGLUTIDA%'
      AND EXISTS (SELECT 1 FROM catalogo_produto cp WHERE cp.ean = m.ean AND cp.preco > 0 AND cp.moeda = 'BRL' AND cp.fonte IN ${inFarm})
    LIMIT 1`, FARM);
if (lir) APRES.push({ ean: lir.ean, nome: `${lir.produto} (liraglutida, ponte)` });
else console.log('(liraglutida sem oferta no catálogo → sonda de ponte PULADA)');

// 3 tipos por apresentação. baseline derivado do MERCADO (não número mágico).
const TIPOS = [
  { tipo: 'alta',   origem: 'declarado',       fator: (med) => med * 1.15, desc: 'mediana×1,15 → deve DISPARAR' },
  { tipo: 'colada', origem: 'declarado',       fator: (med, menor) => menor, desc: 'menor preço → CONTROLE (não dispara)' },
  { tipo: 'media',  origem: 'aceito_sugerido', fator: (med) => med,         desc: 'mediana → caso REALISTA' },
];
// Sondas OPCIONAIS de parâmetro alternativo (comparar lado a lado), sobre Ozempic 1mg, tipo MEDIA.
const ALT = [
  { tipo: 'media-piso120',  ean: '7897705202586', nome: 'Ozempic 1mg', limiar: 8,  piso: 120, origem: 'aceito_sugerido' },
  { tipo: 'media-limiar10', ean: '7897705202586', nome: 'Ozempic 1mg', limiar: 10, piso: 80,  origem: 'aceito_sugerido' },
];

async function ensureUsuario(email) { await pool.query("INSERT IGNORE INTO usuario (email, pais) VALUES (?, 'BR')", [email]); }
async function inserirSonda({ email, ean, baseline, sugerido, origem, limiar = null, piso = null }) {
  // REPLICA o POST /monitor-usuario (mesmos campos); limiar/piso só quando sonda de parâmetro alt.
  const cols = ['utilizador', 'ean', 'baseline_declarado', 'baseline_sugerido', 'baseline_origem'];
  const vals = [email, ean, baseline, sugerido, origem];
  if (limiar != null) { cols.push('limiar_pct'); vals.push(limiar); }
  if (piso != null) { cols.push('piso_abs'); vals.push(piso); }
  await pool.query(
    `INSERT INTO usuario_monitor (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE baseline_declarado = VALUES(baseline_declarado), baseline_sugerido = VALUES(baseline_sugerido),
       baseline_origem = VALUES(baseline_origem), ativo = 1`, vals);
}

const linhas = [];
for (const a of APRES) {
  const arr = await precosMercado(a.ean);
  const med = mediana(arr), menor = arr[0] ?? null;
  for (const t of TIPOS) {
    const email = emailTipo(t.tipo);
    await ensureUsuario(email);
    const baseline = med == null ? null : Math.round(t.fator(med, menor) * 100) / 100;
    if (baseline == null) { linhas.push({ apres: a.nome, tipo: t.tipo, med, menor, baseline: null, exp: 'sem mercado' }); continue; }
    await inserirSonda({ email, ean: a.ean, baseline, sugerido: med, origem: t.origem });
    linhas.push({ apres: a.nome, tipo: t.tipo, med, menor, baseline, exp: dispara(baseline, menor) ? 'DISPARA' : 'não' });
  }
}
// sondas de parâmetro alternativo
for (const x of ALT) {
  const arr = await precosMercado(x.ean);
  const med = mediana(arr), menor = arr[0] ?? null;
  if (med == null) continue;
  const email = emailTipo(x.tipo);
  await ensureUsuario(email);
  await inserirSonda({ email, ean: x.ean, baseline: med, sugerido: med, origem: x.origem, limiar: x.limiar, piso: x.piso });
  linhas.push({ apres: `${x.nome} [limiar${x.limiar}/piso${x.piso}]`, tipo: x.tipo, med, menor, baseline: med, exp: dispara(med, menor, x.limiar, x.piso) ? 'DISPARA' : 'não' });
}

console.log(`\nutilizador de sondagem: ${PREFIXO}+{alta,colada,media,…}@${DOMINIO}  (DADO DE TESTE)`);
console.log('\nAPRESENTAÇÃO                          TIPO            MEDIANA   MENOR   BASELINE   ESPERADO');
for (const l of linhas) {
  console.log(
    `${l.apres.padEnd(36)}  ${l.tipo.padEnd(14)}  ${String(l.med ?? '—').padStart(7)}  ${String(l.menor ?? '—').padStart(6)}  ${String(l.baseline ?? '—').padStart(8)}   ${l.exp}`);
}
const [[tot]] = await pool.query(`SELECT COUNT(*) n FROM usuario_monitor WHERE utilizador LIKE '${PREFIXO}%' AND ativo = 1`);
console.log(`\n${tot.n} sondas ativas plantadas. Rode o motor (cron 4/4h ou scripts/avaliar_alertas.mjs) e depois scripts/relatorio_alertas.mjs.`);
console.log(`Limpar: node --env-file=.env scripts/seed_sondas_calibracao.mjs --reset`);
await closePool();

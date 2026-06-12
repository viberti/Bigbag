// AVALIAÇÃO da Fase 1 (classificação por catálogo) sobre os SKUs REAIS:
// 1) cobertura — quantos SKUs o voto consegue classificar (e por que via);
// 2) acordo — grupo do voto vs sku.grupo (o vocabulário fechado em produção);
// 3) relatório Fase 2 — folhas vencedoras frequentes SEM tipoConsumidor
//    (candidatas curadas a novos tipos de UI da lista). Só leitura.
//   sudo -u dev node --env-file=.env scripts/avaliar_classificacao_catalogo.mjs [--max=400]
import { getPool } from '../src/db.js';
import { classificarPorCatalogo } from '../src/normaliza/classificarCatalogo.js';
import { tipoConsumidor } from '../src/normaliza/categoria.js';

const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1] || 1000);
const pool = getPool();

const [skus] = await pool.query(`
  SELECT s.id, s.nome_canonico, s.grupo,
         (SELECT i.ean FROM item i WHERE i.sku_id = s.id AND i.ean IS NOT NULL AND i.ean <> '' LIMIT 1) AS ean
  FROM sku_normalizado s WHERE s.nome_canonico IS NOT NULL ORDER BY s.id LIMIT ?`, [MAX]);
console.log(`SKUs a avaliar: ${skus.length}`);

let comVoto = 0, viaEan = 0, acordoGrupo = 0, comGrupoAmbos = 0;
let fiaveis = 0, acordoFiavel = 0, ambosFiavel = 0;
const desacordos = [], folhas = new Map(), confs = [];
for (const s of skus) {
  const r = await classificarPorCatalogo(pool, { nome: s.nome_canonico, ean: s.ean });
  if (!r) continue;
  comVoto++; confs.push(r.confianca);
  if (r.via === 'ean') viaEan++;
  if (r.fiavel) fiaveis++;
  if (s.grupo && s.grupo !== 'outros' && r.grupo && r.grupo !== 'outros') {
    comGrupoAmbos++;
    if (r.fiavel) ambosFiavel++;
    if (r.grupo === s.grupo) { acordoGrupo++; if (r.fiavel) acordoFiavel++; }
    else if (desacordos.length < 25) desacordos.push({ nome: s.nome_canonico, sku: s.grupo, voto: r.grupo, folha: r.folha, conf: r.confianca, fiavel: r.fiavel });
  }
  if (!r.fiavel) continue; // o relatório de folhas só com voto fiável
  const f = folhas.get(r.folha) || { n: 0, exemplo: s.nome_canonico, conf: 0 };
  f.n++; f.conf += r.confianca; folhas.set(r.folha, f);
}

console.log(`\n— Cobertura: ${comVoto}/${skus.length} (${Math.round((100 * comVoto) / skus.length)}%) · via EAN: ${viaEan} · via vizinhança: ${comVoto - viaEan} · fiáveis: ${fiaveis}`);
confs.sort((a, b) => a - b);
console.log(`— Confiança: mediana ${confs[Math.floor(confs.length / 2)] ?? '—'} · p25 ${confs[Math.floor(confs.length * 0.25)] ?? '—'}`);
console.log(`— Acordo de GRUPO (voto vs sku.grupo, ambos != outros): ${acordoGrupo}/${comGrupoAmbos} (${comGrupoAmbos ? Math.round((100 * acordoGrupo) / comGrupoAmbos) : 0}%)`);
console.log(`— Acordo SÓ FIÁVEIS: ${acordoFiavel}/${ambosFiavel} (${ambosFiavel ? Math.round((100 * acordoFiavel) / ambosFiavel) : 0}%)`);
console.log('\n— Desacordos (amostra p/ inspeção — quem tem razão?):');
for (const d of desacordos) console.log(`  ${d.fiavel ? '⚠' : ' '} ${d.nome.slice(0, 38).padEnd(38)} sku=${d.sku.padEnd(10)} voto=${d.voto.padEnd(10)} folha="${d.folha}" conf=${d.conf}`);

console.log('\n— Folhas vencedoras SEM tipoConsumidor (candidatas a tipo de UI, n≥3):');
// tipoConsumidor(grupo, nome): tipo SALIENTE pelo nome da folha? (grupo 'outros'
// → cai no residual; interessa-nos quem NÃO tem regra de nome própria)
const TIPOS_SALIENTES = new Set(['massa', 'pao', 'cereais', 'conservas', 'tomate']);
const semTipo = [...folhas.entries()]
  .filter(([f, v]) => v.n >= 3 && !TIPOS_SALIENTES.has(tipoConsumidor('outros', f, null)))
  .sort((a, b) => b[1].n - a[1].n).slice(0, 20);
for (const [f, v] of semTipo) console.log(`  ${String(v.n).padStart(3)}×  "${f}"  (ex: ${v.exemplo.slice(0, 40)}; conf média ${Math.round((100 * v.conf) / v.n) / 100})`);
process.exit(0);

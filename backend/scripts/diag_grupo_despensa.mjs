// Diagnóstico ONE-OFF (não-destrutivo): para cada EAN, mostra de ONDE vem o grupo
// — OFF food_groups, categoria de loja (catalogo_produto por EAN), e SKU casado.
// Uso: sudo -u dev node --env-file=.env scripts/diag_grupo_despensa.mjs
import { getPool } from '../src/db.js';
import { classificarPorCatalogo } from '../src/normaliza/classificarCatalogo.js';
import { grupoDeNome, grupoDeTexto, grupoDe } from '../src/normaliza/categoria.js';

const EANS = [
  ['8402001002014', 'Sésamo Ajonjolí'],
  ['20764197', 'Lentilhas'],
  ['8480000167637', 'Milho Doce'],
  ['20856090', 'Milho Doce Orgânico Freshona'],
  ['4337182251620', 'Carciofi Alla Contadina In Olio'],
  ['8480000062857', 'Pérolas'],
  ['5603697272139', 'Massa Chinesa com Ovo Koala'],
  ['8003740039073', 'Concchiglioni'],
];
const pool = getPool();

for (const [ean, nome] of EANS) {
  console.log('\n═══', ean, nome);
  // OFF food_groups + categoria da ficha
  const [[pe]] = await pool.query(
    `SELECT off_json->'$.grupos_alimento' AS fg, off_json->'$.categoria' AS cat
       FROM produto_ean WHERE ean = ? AND off_json IS NOT NULL LIMIT 1`, [ean]);
  console.log('  OFF foodGroups:', pe?.fg ?? '—', '| OFF categoria:', pe?.cat ?? '—');
  // catálogo por EAN (path da loja)
  const [cat] = await pool.query(
    `SELECT fonte, COALESCE(NULLIF(categoria_path,''), categoria) AS path
       FROM catalogo_produto WHERE ean = ? AND COALESCE(NULLIF(categoria_path,''), NULLIF(categoria,'')) IS NOT NULL LIMIT 5`, [ean]);
  console.log('  catálogo(EAN):', cat.length ? cat.map((c) => `${c.fonte}:${c.path}`).join(' || ') : '—');
  // voto efetivo do catálogo
  try {
    const r = await classificarPorCatalogo(pool, { nome, ean });
    console.log('  classificarPorCatalogo →', JSON.stringify(r));
  } catch (e) { console.log('  classificarPorCatalogo ERRO', e.message); }
  // SKU casado por nome (via item.ean → sku) + grupo guardado
  const [sku] = await pool.query(
    `SELECT DISTINCT s.id, s.nome_canonico, s.grupo FROM item i
       JOIN sku_normalizado s ON s.id = i.sku_id WHERE i.ean = ? LIMIT 3`, [ean]);
  console.log('  SKU(por EAN no item):', sku.length ? sku.map((s) => `#${s.id} ${s.nome_canonico} [grupo=${s.grupo}]`).join(' || ') : '—');
  // funções puras
  console.log('  puro: grupoDeTexto=', grupoDeTexto(nome), '| grupoDeNome=', grupoDeNome(nome),
    '| grupoDe(OFF+nome)=', grupoDe({ foodGroups: pe?.fg ? JSON.parse(pe.fg) : null, nome }));
}
await pool.end();

// Agregação para o DASHBOARD de gestão (/dash): panorama de fontes, países, visão global.
// Cacheado em memória (as contagens são pesadas e os dados mudam devagar). Os custos de IA
// vêm do endpoint /admin/custos (não duplicar aqui).
import { getPool } from './db.js';

// METADATA por fonte (país + plataforma tecnológica). Display-only; o resto vem da BD.
// País 'Global' = backstop OFF (multi-país). Fontes não mapeadas caem em {pais:'—'}.
export const FONTE_META = {
  // Portugal
  auchan: { pais: 'PT', plataforma: 'Scrape HTML' },
  continente: { pais: 'PT', plataforma: 'Scrape HTML' },
  pingodoce: { pais: 'PT', plataforma: 'Scrape HTML' },
  lidl: { pais: 'PT', plataforma: 'Scrape HTML' },
  nutripedia: { pais: 'PT', plataforma: 'Transfer-state' },
  // Espanha
  mercadona: { pais: 'ES', plataforma: 'Scrape JSON' },
  'mercadona-off': { pais: 'ES', plataforma: 'Dump OFF' },
  consum: { pais: 'ES', plataforma: 'JSON-LD' },
  // França / Áustria
  'lidl-fr': { pais: 'FR', plataforma: 'Scrape' },
  leclerc: { pais: 'FR', plataforma: 'Scrape' },
  piccantino: { pais: 'AT', plataforma: 'Scrape' },
  // Brasil (VTEX = API pública catalog_system)
  gbarbosa: { pais: 'BR', plataforma: 'VTEX (API)' },
  supernosso: { pais: 'BR', plataforma: 'VTEX (API)' },
  atacadao: { pais: 'BR', plataforma: 'VTEX (API)' },
  bretas: { pais: 'BR', plataforma: 'VTEX (API)' },
  prezunic: { pais: 'BR', plataforma: 'VTEX (API)' },
  zonasul: { pais: 'BR', plataforma: 'VTEX (API)' },
  carone: { pais: 'BR', plataforma: 'VTEX (API)' },
  zaffari: { pais: 'BR', plataforma: 'VTEX (API)' },
  comper: { pais: 'BR', plataforma: 'VTEX (API)' },
  savegnago: { pais: 'BR', plataforma: 'VTEX (API)' },
  giassi: { pais: 'BR', plataforma: 'VTEX (API)' },
  supermuffato: { pais: 'BR', plataforma: 'VTEX (API)' },
  mambo: { pais: 'BR', plataforma: 'VTEX (API)' },
  paulistao: { pais: 'BR', plataforma: 'VTEX (API)' },
  gigaatacado: { pais: 'BR', plataforma: 'VTEX (API)' },
  festval: { pais: 'BR', plataforma: 'VTEX (API)' },
  covabra: { pais: 'BR', plataforma: 'VTEX (API)' },
  hortifruti: { pais: 'BR', plataforma: 'VTEX (API)' },
  obahortifruti: { pais: 'BR', plataforma: 'VTEX (API)' },
  paodeacucar: { pais: 'BR', plataforma: 'Linx/GPA (API)' },
  mundial: { pais: 'BR', plataforma: 'GraphQL próprio' },
  superprix: { pais: 'BR', plataforma: 'VipCommerce (API)' },
  condor: { pais: 'BR', plataforma: 'Scrape' },
  harvest: { pais: 'BR', plataforma: 'EANs minados' },
};
const meta = (fonte) => FONTE_META[fonte] || { pais: '—', plataforma: '—' };
const EAN_OK = "ean IS NOT NULL AND TRIM(ean)<>''";
const COL = 'utf8mb4_unicode_ci';

// off_full / off_produto são dumps ESTÁTICOS (4,5M) → contam 1× por processo (scans caros).
let _off = null;
async function offCounts(pool) {
  if (_off) return _off;
  const [[full]] = await pool.query(
    `SELECT COUNT(*) produtos, COUNT(*) eans, SUM(imagem_url IS NOT NULL AND imagem_url<>'') fotos,
            SUM(energia_kcal IS NOT NULL) com_nutricao, SUM(ingredientes IS NOT NULL AND ingredientes<>'') com_ingredientes
       FROM off_full`);
  const [[prod]] = await pool.query(
    `SELECT COUNT(*) produtos, COUNT(DISTINCT ean) eans, SUM(nutricao IS NOT NULL) com_nutricao FROM off_produto`);
  _off = { full, prod };
  return _off;
}

let _cache = null; let _at = 0;
const TTL = 20 * 60 * 1000; // 20 min

export async function panoramaDashboard({ forcar = false } = {}) {
  if (_cache && !forcar && Date.now() - _at < TTL) return { ..._cache, cacheado: true };
  const pool = getPool();

  // 1) métricas por fonte de catálogo
  const [base] = await pool.query(
    `SELECT fonte, COUNT(*) produtos, COUNT(DISTINCT NULLIF(TRIM(ean),'')) eans,
            SUM(imagem_url IS NOT NULL AND imagem_url<>'') fotos,
            SUM(nutricao IS NOT NULL) com_nutricao,
            SUM(ingredientes IS NOT NULL AND TRIM(ingredientes)<>'') com_ingredientes
       FROM catalogo_produto GROUP BY fonte`);

  // 2) EANs ÚNICOS por fonte = EAN só nesta fonte (entre lojas) E ausente do off_full
  const [uniq] = await pool.query(
    `SELECT u.fonte, COUNT(*) n FROM (
       SELECT ean, MAX(fonte) fonte FROM catalogo_produto
        WHERE ${EAN_OK} GROUP BY ean HAVING COUNT(DISTINCT fonte)=1
     ) u LEFT JOIN off_full f ON f.ean = u.ean COLLATE ${COL}
      WHERE f.ean IS NULL GROUP BY u.fonte`);
  const unicoDe = Object.fromEntries(uniq.map((r) => [r.fonte, Number(r.n)]));

  const off = await offCounts(pool);
  // fontes = catálogo + os dois dumps OFF (linhas especiais)
  const fontes = base.map((r) => ({
    fonte: r.fonte, ...meta(r.fonte),
    produtos: Number(r.produtos), eans: Number(r.eans), fotos: Number(r.fotos),
    com_nutricao: Number(r.com_nutricao), com_ingredientes: Number(r.com_ingredientes),
    eans_unicos: unicoDe[r.fonte] ?? 0,
  }));
  fontes.push({ fonte: 'off_full', pais: 'Global', plataforma: 'Dump OFF (DuckDB)',
    produtos: Number(off.full.produtos), eans: Number(off.full.eans), fotos: Number(off.full.fotos),
    com_nutricao: Number(off.full.com_nutricao), com_ingredientes: Number(off.full.com_ingredientes), eans_unicos: null });
  fontes.push({ fonte: 'off_produto', pais: 'Global', plataforma: 'Dump OFF (antigo)',
    produtos: Number(off.prod.produtos), eans: Number(off.prod.eans), fotos: 0,
    com_nutricao: Number(off.prod.com_nutricao), com_ingredientes: 0, eans_unicos: null });
  fontes.sort((a, b) => b.produtos - a.produtos);

  // 3) países (catálogo): nº de fontes + EANs distintos por país. País por CASE de metadata.
  const casePais = 'CASE fonte ' + Object.entries(FONTE_META).map(([f, m]) => `WHEN ${pool.escape(f)} THEN ${pool.escape(m.pais)}`).join(' ') + " ELSE '—' END";
  const [porPais] = await pool.query(
    `SELECT ${casePais} pais, COUNT(DISTINCT fonte) n_fontes, COUNT(DISTINCT NULLIF(TRIM(ean),'')) eans
       FROM catalogo_produto GROUP BY pais ORDER BY eans DESC`);
  const paises = porPais.map((r) => ({ pais: r.pais, n_fontes: Number(r.n_fontes), eans: Number(r.eans) }));

  // 4) visão global
  const [[cat]] = await pool.query(`SELECT COUNT(DISTINCT NULLIF(TRIM(ean),'')) n FROM catalogo_produto`);
  // EANs do catálogo ausentes do off_full (a novidade que o retalho traz além do OFF)
  const [[novos]] = await pool.query(
    `SELECT COUNT(*) n FROM (SELECT DISTINCT ean FROM catalogo_produto WHERE ${EAN_OK}) c
       LEFT JOIN off_full f ON f.ean = c.ean COLLATE ${COL} WHERE f.ean IS NULL`);
  const [[catNut]] = await pool.query(
    `SELECT COUNT(DISTINCT NULLIF(TRIM(ean),'')) n FROM catalogo_produto WHERE nutricao IS NOT NULL AND ${EAN_OK}`);
  const paisesCobertos = new Set(paises.map((p) => p.pais).filter((p) => p !== '—' && p !== 'Global')).size;

  const global = {
    paises_cobertos: paisesCobertos,
    ean_catalogo: Number(cat.n),                 // EANs distintos no catálogo (retalho)
    ean_off: Number(off.full.eans),              // EANs no OFF (backstop universal)
    ean_unico_global: Number(off.full.eans) + Number(novos.n), // dedup global (OFF + retalho extra)
    ean_novos_retalho: Number(novos.n),          // EANs de retalho que o OFF não tem
    ean_com_nutricao: Number(off.full.com_nutricao), // do OFF (universal)
    ean_com_nutricao_catalogo: Number(catNut.n),     // do catálogo de loja
  };

  _cache = { fontes, paises, global, gerado_em: new Date().toISOString() };
  _at = Date.now();
  return { ..._cache, cacheado: false };
}

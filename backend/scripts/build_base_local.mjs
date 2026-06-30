// Reconstrói base_local (migração 067): a réplica de IDENTIFICAÇÃO+NUTRIÇÃO que vai ao
// telefone para o scan responder instantâneo/offline. Idempotente (TRUNCATE + rebuild).
// Âmbito inicial (dono, 2026-06-17 — "começar com menos e medir"):
//   pt_cat  = EANs que coletámos em PT no catálogo (auchan/continente/pingodoce/nutripedia)
//   merc_es = Mercadona Espanha (mercadona/mercadona-off)
//   pt_off  = EANs portugueses do off_full (paises_tags portugal) ainda não cobertos
// Nutrição: catálogo (oficial) > off_full (colunas planas, mapeadas). Sem LLM nem live.
// LIDL/ALDI ficam DE FORA de propósito — base_local_evento mede o que se perde.
//   sudo -u dev node --env-file=.env scripts/build_base_local.mjs
import { getPool } from '../src/db.js';

const pool = getPool();
const CAT_FONTES = ['auchan', 'continente', 'pingodoce', 'nutripedia', 'mercadona', 'mercadona-off'];
const EAN_OK = "ean REGEXP '^[0-9]{8,14}$'";
// nutrição construída a partir das colunas planas do off_full (mapeia gordura_sat/proteinas)
const NUT_OFF = `JSON_OBJECT(
  'sal',o.sal,'fibra',o.fibra,'gordura',o.gordura,'acucares',o.acucares,
  'hidratos',o.hidratos,'proteina',o.proteinas,'energia_kcal',o.energia_kcal,
  'gordura_saturada',o.gordura_sat)`;
// off_full guarda nutriscore como 'a'..'e' mas também 'not-applicable'/'unknown' → só letra
const NS = "CASE WHEN o.nutriscore REGEXP '^[a-eA-E]$' THEN LOWER(o.nutriscore) ELSE NULL END";

// NÃO se faz TRUNCATE: a base_local CRESCE com o uso (linhas origem='uso', inseridas pelo
// consultarOuGuardar a cada miss resolvido) e um rebuild do bootstrap não as pode apagar.
// Pass 1 faz upsert (ON DUPLICATE) → re-correr refresca o catálogo, preserva 'uso' e mantém
// o `seq` das linhas existentes (não força re-sync inútil no telefone). Stale do catálogo
// que saiu da fonte fica (inofensivo: a nutrição continua válida).
console.log('[base_local] rebuild idempotente (preserva linhas vivas origem=uso)…');

// Melhor linha de catálogo por EAN: prefere a que TEM nutrição, depois a fonte PT mais fiável.
console.log('[base_local] melhor linha de catálogo por EAN (bl_cat)…');
await pool.query('DROP TEMPORARY TABLE IF EXISTS bl_cat');
await pool.query(
  `CREATE TEMPORARY TABLE bl_cat (
     ean VARCHAR(20) PRIMARY KEY, nome VARCHAR(255), marca VARCHAR(120),
     quantidade VARCHAR(80), categoria VARCHAR(120), product_type VARCHAR(20),
     ingredientes TEXT, nutricao JSON, origem VARCHAR(12)) ENGINE=InnoDB`,
);
await pool.query(
  `INSERT INTO bl_cat
   SELECT ean, nome, marca, quantidade, categoria, product_type, ingredientes, nutricao, origem FROM (
     SELECT ean,
            LEFT(COALESCE(NULLIF(nome_pt,''),nome),255) AS nome, LEFT(marca,120) AS marca,
            LEFT(formato,80) AS quantidade, LEFT(categoria,120) AS categoria, product_type,
            ingredientes, nutricao,
            CASE WHEN fonte IN ('mercadona','mercadona-off') THEN 'merc_es' ELSE 'pt_cat' END AS origem,
            ROW_NUMBER() OVER (
              PARTITION BY ean
              ORDER BY (nutricao IS NOT NULL) DESC,
                       FIELD(fonte,'continente','auchan','pingodoce','nutripedia','mercadona','mercadona-off')
            ) AS rn
       FROM catalogo_produto
      WHERE fonte IN (${CAT_FONTES.map(() => '?').join(',')}) AND ${EAN_OK}
            AND COALESCE(NULLIF(nome_pt,''),nome) <> ''
   ) t WHERE rn = 1`,
  CAT_FONTES,
);
const [[{ c: nCat }]] = await pool.query('SELECT COUNT(*) c FROM bl_cat');
console.log(`[base_local] bl_cat = ${nCat} EANs de catálogo`);

// Passo 1: EANs com linha de catálogo (pt_cat/merc_es) — catálogo manda; off_full preenche
// nutrição em falta, alergénios, nutriscore, nova, ingredientes.
console.log('[base_local] passo 1: catálogo PT + Mercadona ES (fundido com off_full)…');
await pool.query(
  `INSERT INTO base_local
     (ean,nome,marca,quantidade,categoria,product_type,alergenios,nutriscore,nova,nutricao,ingredientes,origem)
   SELECT c.ean, c.nome, c.marca, c.quantidade, c.categoria, c.product_type,
          LEFT(o.alergenios,255), ${NS}, o.nova,
          CASE WHEN JSON_EXTRACT(c.nutricao,'$.energia_kcal') IS NOT NULL THEN c.nutricao
               WHEN o.energia_kcal IS NOT NULL THEN ${NUT_OFF}
               ELSE c.nutricao END,
          LEFT(COALESCE(NULLIF(c.ingredientes,''), o.ingredientes), 1200),
          c.origem
     FROM bl_cat c
     LEFT JOIN off_full o ON o.ean = c.ean
   ON DUPLICATE KEY UPDATE
     nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
     product_type=VALUES(product_type), alergenios=VALUES(alergenios), nutriscore=VALUES(nutriscore),
     nova=VALUES(nova), nutricao=VALUES(nutricao), ingredientes=VALUES(ingredientes), origem=VALUES(origem)`,
);
const [[{ c: n1 }]] = await pool.query('SELECT COUNT(*) c FROM base_local');
console.log(`[base_local] após passo 1 = ${n1}`);

// Passo 2: EANs PORTUGUESES do off_full ainda não cobertos (pt_off). INSERT IGNORE → o
// catálogo do passo 1 prevalece nos EANs partilhados; só entram os off_full-only.
console.log('[base_local] passo 2: PT do off_full (não cobertos)…');
await pool.query(
  `INSERT IGNORE INTO base_local
     (ean,nome,marca,quantidade,categoria,product_type,alergenios,nutriscore,nova,nutricao,ingredientes,origem)
   SELECT o.ean, LEFT(o.nome,255), LEFT(o.marca,120), LEFT(o.quantidade,80), LEFT(o.categoria,120), NULL,
          LEFT(o.alergenios,255), ${NS}, o.nova,
          CASE WHEN o.energia_kcal IS NOT NULL THEN ${NUT_OFF} ELSE NULL END,
          LEFT(o.ingredientes,1200), 'pt_off'
     FROM off_full o
    WHERE o.paises_tags LIKE '%portugal%' AND ${EAN_OK} AND o.nome IS NOT NULL AND o.nome <> ''`,
);

// Passo 3 (2026-06-25): SOBREPOR a FICHA FUNDIDA (produto_ean = fonte canónica) — nome/marca/
// ingredientes/nutrição/alergénios já decididos pelo fusor (Nutripédia>lojas>OFF) vencem o que o
// bootstrap pôs. Preserva o que a ficha NÃO tem (COALESCE) e o product_type/nutriscore/nova da base.
// DELETE+INSERT (não ON DUPLICATE) para ganhar `seq` novo → as linhas mudadas RE-SINCRONIZAM no telefone.
console.log('[base_local] passo 3: sobrepor a ficha fundida (produto_ean)…');
await pool.query('DROP TEMPORARY TABLE IF EXISTS bl_merge');
await pool.query(
  `CREATE TEMPORARY TABLE bl_merge AS
   SELECT pe.ean,
     LEFT(COALESCE(NULLIF(pe.nome,''), b.nome),255) nome,
     LEFT(COALESCE(NULLIF(pe.marca,''), b.marca),120) marca,
     LEFT(COALESCE(NULLIF(pe.quantidade,''), b.quantidade),80) quantidade,
     LEFT(COALESCE(NULLIF(pe.categoria,''), b.categoria),120) categoria,
     b.product_type, LEFT(COALESCE(NULLIF(pe.alergenios,''), b.alergenios),255) alergenios,
     b.nutriscore, b.nova,
     COALESCE(pe.nutricao, b.nutricao) nutricao,
     LEFT(COALESCE(NULLIF(pe.ingredientes,''), b.ingredientes),1200) ingredientes,
     COALESCE(b.origem,'uso') origem
   FROM produto_ean pe LEFT JOIN base_local b ON b.ean = pe.ean
   WHERE pe.ean IS NOT NULL AND pe.ean <> '' AND pe.nome IS NOT NULL AND pe.nome <> ''`,
);
await pool.query('DELETE FROM base_local WHERE ean IN (SELECT ean FROM bl_merge)');
await pool.query(
  `INSERT INTO base_local (ean,nome,marca,quantidade,categoria,product_type,alergenios,nutriscore,nova,nutricao,ingredientes,origem)
   SELECT ean,nome,marca,quantidade,categoria,product_type,alergenios,nutriscore,nova,nutricao,ingredientes,origem FROM bl_merge`,
);
const [[ov]] = await pool.query('SELECT COUNT(*) n FROM bl_merge');
console.log(`[base_local] passo 3: ${ov.n} fichas sobrepostas`);
await pool.query('DROP TEMPORARY TABLE IF EXISTS bl_merge');

await pool.query('DROP TEMPORARY TABLE IF EXISTS bl_cat');

// GATE de qualidade: a materialização por SQL não passa pelo `nutricaoPlausivel` do fusor →
// limpa a nutrição implausível (kcal incoerente com macros, saturada>gordura, negativos…)
// para não materializar lixo nos telefones. Idempotente. (validadores.js, 2026-06-30.)
const { limparNutricaoBaseLocal } = await import('./limpar_nutricao_base_local.mjs');
await limparNutricaoBaseLocal(pool);

// Nutri-Score numérico materializado (migr. 095) — cache regenerável p/ auditoria. DEPOIS da limpeza.
const { calcularNutriscoreBaseLocal } = await import('./calcular_nutriscore_base_local.mjs');
await calcularNutriscoreBaseLocal(pool);

// Relatório
const [[tot]] = await pool.query(
  `SELECT COUNT(*) total,
          SUM(nutricao IS NOT NULL) com_nut,
          SUM(origem='pt_cat') pt_cat, SUM(origem='merc_es') merc_es, SUM(origem='pt_off') pt_off
     FROM base_local`,
);
console.log('\n=== base_local construída ===');
console.log(`total: ${tot.total}  (com nutrição: ${tot.com_nut} = ${(tot.com_nut / tot.total * 100).toFixed(0)}%)`);
console.log(`origem: pt_cat=${tot.pt_cat}  merc_es=${tot.merc_es}  pt_off=${tot.pt_off}`);
await pool.end();

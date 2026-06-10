-- Extrato LOCAL do dump do Open Food Facts (Analise_Fontes: fontes p/ discounters).
-- Lidl/Aldi não publicam catálogo, mas as marcas deles são das mais bem cobertas
-- do OFF (Lidl: 18,5k produtos; Milsani: 1,5k). Importado por
-- scripts/importar_off.mjs (streaming do dump .jsonl.gz, filtro marcas+PT).
-- Papel: cache local do OFF — consultarOuGuardar/enriquecer consultam AQUI antes
-- da API (instantâneo, offline, sem rate-limit). NÃO entra na base-local dos
-- clientes (só produtos consultados ganham ficha em produto_ean, como antes).
CREATE TABLE off_produto (
  ean         VARCHAR(20) PRIMARY KEY,
  nome        VARCHAR(255),
  nome_pt     VARCHAR(255),            -- product_name_pt quando existe
  marca       VARCHAR(160),
  quantidade  VARCHAR(60),
  categoria   VARCHAR(255),            -- categories (texto legível)
  categorias_tags JSON,                -- DAG (en:yogurts, …)
  grupos_alimento JSON,                -- food_groups_tags
  labels      JSON,                    -- labels_tags (bio/vegan/sem-lactose…)
  nutriscore  CHAR(1),
  nova        TINYINT,
  alergenios  VARCHAR(255),
  ingredientes TEXT,
  nutricao    JSON,                    -- por 100 g (subset: energia/gordura/sat/hidratos/açúcares/proteína/sal/fibra)
  paises      VARCHAR(255),            -- countries_tags abreviado (pt visível)
  importado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_off_marca (marca)
);

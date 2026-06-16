-- 067: BASE LOCAL pré-construída para o telefone (réplica de identificação+nutrição).
-- Decisão do dono (2026-06-17): "começar com menos, medir a taxa de hits no telefone e ir
-- ajustando". Âmbito inicial = todos os EANs que COLETÁMOS em Portugal (catálogo, sem OFF:
-- auchan/continente/pingodoce/nutripedia) + os EANs PORTUGUESES do OFF + Mercadona Espanha,
-- COM a tabela nutricional junto. ~65k fichas, ~37 MB no IndexedDB. LIDL/ALDI ficam DE FORA
-- de propósito — a telemetria (base_local_evento) mede o que se perde com isso.
--
-- base_local é MATERIALIZADA por scripts/build_base_local.mjs (fusão offline catálogo+off_full,
-- sem LLM nem chamadas live). Servida ao telefone incremental por cursor de `ean`.
CREATE TABLE IF NOT EXISTS base_local (
  ean          VARCHAR(20)  NOT NULL,
  nome         VARCHAR(255),
  marca        VARCHAR(120),
  quantidade   VARCHAR(80),
  categoria    VARCHAR(120),
  product_type VARCHAR(20),
  alergenios   VARCHAR(255),
  nutriscore   CHAR(1),
  nova         TINYINT,
  nutricao     JSON,                 -- por 100g: {sal,fibra,gordura,acucares,hidratos,proteina,energia_kcal,gordura_saturada}
  ingredientes TEXT,
  origem       VARCHAR(12),          -- pt_cat | merc_es | pt_off (qual sub-âmbito reclamou o EAN)
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Telemetria da BASE LOCAL: cada resolução de um EAN no telefone regista se foi um HIT
-- (resolvido localmente, instantâneo/offline) ou MISS (teve de ir ao servidor). O EAN dos
-- misses diz-nos exatamente o que falta na base (p.ex. produtos LIDL/ALDI europeus).
CREATE TABLE IF NOT EXISTS base_local_evento (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ean    VARCHAR(20),
  hit    TINYINT NOT NULL,          -- 1 = resolvido no telefone, 0 = foi ao servidor
  origem VARCHAR(20),               -- contexto: 'scan' | 'consulta' | ...
  em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY k_em (em),
  KEY k_ean (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

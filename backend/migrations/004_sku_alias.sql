-- Migração 004 — tabela de aliases da normalização de SKU.
-- Mapeia a descrição original EXATA → sku_id. É a cache que resolve a próxima
-- ocorrência da mesma string instantaneamente (sem LLM, sem erro repetido).
-- Populada pela canonicalização (origem 'llm') ou por confirmação ('revisao').

CREATE TABLE sku_alias (
  id                 BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  descricao_original VARCHAR(200) NOT NULL,
  sku_id             BIGINT UNSIGNED NOT NULL,
  origem             VARCHAR(20) NOT NULL DEFAULT 'llm',   -- 'llm','revisao','manual'
  criado_em          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alias_desc (descricao_original),
  CONSTRAINT fk_alias_sku FOREIGN KEY (sku_id) REFERENCES sku_normalizado(id) ON DELETE CASCADE,
  KEY idx_alias_sku (sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Caracterização genérica de um produto pelo NOME (sem EAN): fresco vs. embalado,
-- e nutrição típica por 100 g para os frescos (fruta, legume, carne/peixe…).
-- Chave: o SKU canónico (o mesmo produto partilha a caracterização).
CREATE TABLE IF NOT EXISTS produto_generico (
  sku_id     BIGINT UNSIGNED PRIMARY KEY,
  tipo       VARCHAR(20),          -- 'fresco' | 'processado'
  alimento   VARCHAR(120),         -- alimento genérico identificado
  categoria  VARCHAR(160),
  nutricao   JSON,                 -- por 100 g (só para 'fresco'); NULL para 'processado'
  modelo     VARCHAR(80),
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sugestões de nome canónico (geradas por LLM das variantes em produto_nome),
-- para o operador rever e aplicar/rejeitar. Uma por SKU.
CREATE TABLE IF NOT EXISTS nome_sugestao (
  sku_id      BIGINT UNSIGNED PRIMARY KEY,
  atual       VARCHAR(200),
  sugerido    VARCHAR(200) NOT NULL,
  variantes   TEXT,                                  -- variantes separadas por '||'
  estado      VARCHAR(12) NOT NULL DEFAULT 'pendente', -- pendente | aplicado | rejeitado
  criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decidido_em TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

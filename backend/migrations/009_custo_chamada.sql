-- Migração 009 — log de custo por chamada ao modelo (OpenRouter devolve o custo
-- exato com usage.include). Permite ver gasto por contexto (extração, consulta…),
-- por modelo, por dia.

CREATE TABLE custo_chamada (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  contexto          VARCHAR(30) NOT NULL,        -- 'extracao_imagem','extracao_texto','consulta','canonicalizar','confirmar','transcricao'
  modelo            VARCHAR(60),
  prompt_tokens     INT,
  completion_tokens INT,
  custo             DECIMAL(12,8) NOT NULL DEFAULT 0,  -- USD
  criado_em         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_custo_ctx (contexto),
  KEY idx_custo_data (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

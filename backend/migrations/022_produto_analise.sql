-- Cache da análise factual de um produto (gerada por LLM a partir dos dados
-- consolidados). Chave: EAN (a análise depende do produto, não do item da nota).
-- Re-gera-se apagando a linha (ou com um futuro "reanalisar").
CREATE TABLE IF NOT EXISTS produto_analise (
  ean        VARCHAR(20) PRIMARY KEY,
  analise    JSON NOT NULL,
  modelo     VARCHAR(80),
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Produto identificado por EAN + fotos (enriquecimento). Guarda o que o VLM
-- extrai dos rótulos E o que o Open Food Facts tem para esse EAN — para
-- alimentar o conselheiro de saúde (nutrição precisa por produto) e comparar
-- fontes. Ver docs/Visao_Conselheiro_Saude_Alimentar.md.
CREATE TABLE IF NOT EXISTS produto_ean (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ean           VARCHAR(20),                 -- código de barras (NULL se não obtido)
  sku_id        BIGINT UNSIGNED,             -- liga ao produto canónico (item de onde veio)
  nome          VARCHAR(200),
  marca         VARCHAR(120),
  quantidade    VARCHAR(60),                 -- peso/volume líquido (ex.: "500 g")
  categoria     VARCHAR(120),
  ingredientes  TEXT,
  alergenios    TEXT,
  validade      VARCHAR(30),                 -- data impressa (texto, como lida)
  nutricao      JSON,                        -- por 100 g/ml (melhor fonte disponível)
  fonte         VARCHAR(10),                 -- 'vlm' | 'off' | 'ambos'
  vlm_json      JSON,                        -- bruto do VLM (debug)
  off_json      JSON,                        -- bruto do OFF (debug)
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ean (ean)                    -- MySQL permite vários NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

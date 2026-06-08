-- As fotos do produto (frente, ingredientes, rótulo, validade) ficam GUARDADAS,
-- ligadas ao ITEM da nota de onde vieram. O foco, por agora, é conhecer muito bem
-- o item comprado; mais tarde decide-se o que é herdado pelo produto normalizado.
ALTER TABLE produto_ean ADD COLUMN item_id BIGINT UNSIGNED NULL AFTER sku_id;

CREATE TABLE IF NOT EXISTS produto_foto (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  item_id    BIGINT UNSIGNED,           -- item da nota a que a foto pertence
  ean        VARCHAR(20),               -- EAN associado (se houver)
  ficheiro   VARCHAR(255) NOT NULL,     -- caminho do ficheiro guardado
  mime       VARCHAR(40),
  ordem      TINYINT DEFAULT 0,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pf_item (item_id),
  KEY idx_pf_ean (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

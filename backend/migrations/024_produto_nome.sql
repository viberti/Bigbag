-- Todos os NOMES que apareceram para um produto (identificado por EAN): do talão,
-- o nome canónico, o lido pelo VLM, o do Open Food Facts (que pode vir noutra
-- língua). Servem para matching de descrições e para construir/afinar o nome
-- canónico. Dedup por (ean, nome).
CREATE TABLE IF NOT EXISTS produto_nome (
  id        BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ean       VARCHAR(20) NOT NULL,
  sku_id    BIGINT UNSIGNED,
  nome      VARCHAR(200) NOT NULL,
  origem    VARCHAR(20),          -- 'talao' | 'canonico' | 'vlm' | 'off'
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ean_nome (ean, nome),
  KEY idx_pn_sku (sku_id),
  KEY idx_pn_ean (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

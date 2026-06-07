-- Produto Mestre: camada de agrupamento NÃO-destrutiva (docs/Taxonomia_Produto.md §4.1/§11).
-- Agrupa SKUs por uma CHAVE canónica determinística (src/normaliza/mestre.js) SEM
-- fundir nem apagar nada — ao contrário do auto-merge destrutivo de hoje.
-- Resolve a fragmentação (ex.: "Maçã Gala" em 3 SKUs → 1 Mestre) preservando os SKUs.
-- `chave` = tuplo canónico (categoria + portões da categoria), valores normalizados.
-- `provisorio` = §11.3: um portão-chave da categoria está em falta (candidato a promoção).
CREATE TABLE produto_mestre (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  chave      VARCHAR(255) NOT NULL,
  categoria  VARCHAR(120),
  nome       VARCHAR(160),                 -- rótulo legível (do SKU mais usado)
  provisorio TINYINT(1) NOT NULL DEFAULT 0,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chave (chave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- O específico (≈ o sku_normalizado de hoje) ganha a ligação ao Mestre. Aditivo:
-- a app continua a usar sku_normalizado; o Mestre é uma vista de agrupamento por cima.
ALTER TABLE sku_normalizado ADD COLUMN mestre_id BIGINT UNSIGNED NULL AFTER id;

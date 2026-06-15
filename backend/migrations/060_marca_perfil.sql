-- marca_perfil: distribuição food/não-food por marca — a fatia "DEPARTAMENTO" do perfil
-- de marca do fusor de categoria (ver docs/Classificacao_Fusor.md). Minada do catálogo
-- (product_type, 058) por scripts/construir_marca_perfil.mjs. Aditiva e reconstruível.
-- Uso: um voto no fusor food/não-food (decidirTipo, marcaShareFood) — especialista de
-- departamento vota forte (Hacendado ~0.99 → food; Deliplus ~0.03 → non_food).
CREATE TABLE IF NOT EXISTS marca_perfil (
  marca_norm    VARCHAR(160) NOT NULL PRIMARY KEY,  -- normAlfa(marca): lower, sem acentos/pontuação
  marca_exemplo VARCHAR(190),                        -- uma grafia original (debug)
  n             INT NOT NULL,                         -- total de produtos da marca no catálogo
  n_food        INT NOT NULL DEFAULT 0,
  n_nonfood     INT NOT NULL DEFAULT 0,
  share_food    FLOAT NULL,                           -- n_food / (n_food + n_nonfood); null se nenhum classificado
  atualizado    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

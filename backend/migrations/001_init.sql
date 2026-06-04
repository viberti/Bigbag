-- Migração 001 — schema inicial do Bigbag (app_bigbag).
-- Verbatim do contrato em docs/Schema_e_Funcoes_ToolUse.md.
-- Aditiva (só CREATE), idempotente o suficiente para BD nova e vazia.
-- A criação da BD / user MySQL / GRANT é passo de infra (runbook §3), não vai aqui.

-- ─────────────────────────────────────────────────────────────
-- LOJA: cada estabelecimento físico. Cadeia + localização em Braga.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE loja (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  cadeia        VARCHAR(40)  NOT NULL,
  nome          VARCHAR(120) NOT NULL,
  nif           VARCHAR(20),
  localizacao   VARCHAR(160),
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loja_nif (nif),
  KEY idx_loja_cadeia (cadeia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- SKU_NORMALIZADO: o produto canónico. Liga o MESMO produto escrito
-- de formas diferentes entre lojas/datas. Coração da comparação.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE sku_normalizado (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nome_canonico VARCHAR(160) NOT NULL,
  marca         VARCHAR(80),
  categoria     VARCHAR(80),
  unidade_base  ENUM('un','kg','L') NOT NULL DEFAULT 'un',
  formato_valor DECIMAL(10,3),
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sku_nome (nome_canonico),
  KEY idx_sku_categoria (categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- FATURA: uma compra. Guarda total impresso E reconciliado para
-- validar a extração (devem bater após distribuir descontos globais).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE fatura (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  loja_id             BIGINT UNSIGNED NOT NULL,
  data_compra         DATETIME NOT NULL,
  total_impresso      DECIMAL(10,2) NOT NULL,
  total_reconciliado  DECIMAL(10,2),
  desconto_global     DECIMAL(10,2) DEFAULT 0,
  ficheiro_original   VARCHAR(255),
  metodo_extracao     ENUM('vlm','ocr_llm'),
  criado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fatura_loja FOREIGN KEY (loja_id) REFERENCES loja(id),
  KEY idx_fatura_data (data_compra)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ITEM: cada linha da fatura. Descrição original (debug) + ligação ao
-- SKU canónico. preco_por_base é o que torna a comparação correta.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE item (
  id                   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  fatura_id            BIGINT UNSIGNED NOT NULL,
  sku_id               BIGINT UNSIGNED,
  descricao_original   VARCHAR(200) NOT NULL,
  quantidade           DECIMAL(10,3) NOT NULL DEFAULT 1,
  preco_unitario       DECIMAL(10,4),
  preco_liquido        DECIMAL(10,2) NOT NULL,
  preco_por_base       DECIMAL(10,4),
  is_clearance         BOOLEAN DEFAULT FALSE,
  desconto_direto      DECIMAL(10,2) DEFAULT 0,
  is_non_product       BOOLEAN DEFAULT FALSE,
  CONSTRAINT fk_item_fatura FOREIGN KEY (fatura_id) REFERENCES fatura(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sku FOREIGN KEY (sku_id) REFERENCES sku_normalizado(id),
  KEY idx_item_sku (sku_id),
  KEY idx_item_fatura (fatura_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 078 — Monitoramento periódico (4/4h) de preço + ESTOQUE de remédios "monitorados".
-- Regra do dono (2026-06-23): remédios numa lista de monitorados têm o preço+estoque
-- colhidos a cada 4 horas e ARMAZENADOS, para um histórico denso de variação e de
-- disponibilidade (esgotou? voltou?). Lista de hoje: OZEMPIC e MOUNJARO.
-- Aditiva, só app_bigbag.

-- Lista de monitorados — por MARCA (produto). O job resolve as EANs com oferta de cada.
CREATE TABLE IF NOT EXISTS medicamento_monitorado (
  produto    VARCHAR(190) NOT NULL,            -- nome do produto/marca (UPPER), ex.: OZEMPIC
  ativo      TINYINT NOT NULL DEFAULT 1,
  criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (produto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Histórico denso: 1 linha por (EAN × farmácia) a cada colheita. disponivel: 1=em estoque,
-- 0=esgotado (a farmácia tem o produto mas sem estoque), e simplesmente não há linha quando
-- a farmácia não carrega o produto. qtd_estoque = AvailableQuantity do VTEX (quando exposto).
CREATE TABLE IF NOT EXISTS medicamento_monitor_hist (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  ean          VARCHAR(14) NOT NULL,
  fonte        VARCHAR(40) NOT NULL,
  preco        DECIMAL(10,2) NULL,
  disponivel   TINYINT NULL,
  qtd_estoque  INT NULL,
  capturado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ean_ts (ean, capturado_em),
  KEY idx_fonte_ts (fonte, capturado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO medicamento_monitorado (produto) VALUES ('OZEMPIC'), ('MOUNJARO');

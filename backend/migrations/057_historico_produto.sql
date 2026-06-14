-- Histórico de produtos CONSULTADOS pelo utilizador (cada ficha de produto aberta).
-- Guarda TODOS os produtos vistos — sinal de interesse, pode ser útil saber neles —
-- com frequência (n_consultas) e recência (ultima_em). A tela mostra os mais
-- recentes. Uma linha por (utilizador, produto): a `chave` deduplica
-- (e:<ean> · s:<sku_id> · n:<nome normalizado>), por isso reconsultar o mesmo
-- produto incrementa o contador em vez de criar linha nova.
CREATE TABLE IF NOT EXISTS historico_produto (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  utilizador   VARCHAR(64)  NOT NULL,
  chave        VARCHAR(255) NOT NULL,
  ean          VARCHAR(14)  NULL,
  sku_id       BIGINT UNSIGNED NULL,
  nome         VARCHAR(255) NOT NULL,
  marca        VARCHAR(140) NULL,
  n_consultas  INT UNSIGNED NOT NULL DEFAULT 1,
  primeira_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_em    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_util_chave (utilizador, chave),
  KEY idx_util_ultima (utilizador, ultima_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Verificação de NOMES da leitura da nota (2.ª opinião dirigida + voto a 3).
-- O nome é o único campo sem checksum (a reconciliação só protege números:
-- "Salara Riso" com preço certo passa). Cada suspeito verificado fica registado —
-- é também o dataset do harness de avaliação de leitores (ground truth acumulado).
CREATE TABLE verificacao_nome (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  fatura_id   BIGINT UNSIGNED NOT NULL,
  item_id     BIGINT UNSIGNED NOT NULL,
  lido        VARCHAR(200) NOT NULL,   -- leitura 1 (extração principal)
  opiniao     VARCHAR(200),            -- leitura 2 (modelo verificador); NULL = sem resposta
  score_lido    DECIMAL(4,2),          -- buscarCatalogo da leitura 1 (0 = nada plausível)
  score_opiniao DECIMAL(4,2),          -- idem para a 2.ª opinião
  resultado   ENUM('confirmado','corrigido','duvida') NOT NULL,
  modelo      VARCHAR(80),             -- modelo da 2.ª opinião
  criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_vn_fatura (fatura_id)
);

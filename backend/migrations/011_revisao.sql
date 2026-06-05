-- Migração 011 — feedback do operador sobre a leitura de cada nota.
-- O operador marca a extração de uma fatura como certa/errada e, se errada,
-- explica o problema. É o sinal humano que alimenta a melhoria do reconhecimento.
CREATE TABLE revisao (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  fatura_id  BIGINT UNSIGNED NOT NULL,
  veredicto  ENUM('ok','erro') NOT NULL,
  comentario TEXT,
  operador   VARCHAR(60),
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_revisao_fatura FOREIGN KEY (fatura_id) REFERENCES fatura(id) ON DELETE CASCADE,
  KEY idx_revisao_fatura (fatura_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

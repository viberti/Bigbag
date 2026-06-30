-- Veredictos da AUDITORIA por LLM da nutrição (camada que precede a revisão humana, 2026-06-30).
-- Os sinais determinísticos sinalizam suspeita; o LLM julga e aponta o campo errado + valor típico.
-- A revisão humana lê só veredicto IN ('erro','incerto'). NÃO altera dados — só analisa.
CREATE TABLE IF NOT EXISTS nutricao_auditoria (
  ean        VARCHAR(20)  NOT NULL PRIMARY KEY,
  nome       VARCHAR(255) NULL,
  familia    VARCHAR(24)  NULL,
  motivo     VARCHAR(40)  NULL,      -- por que foi sinalizado (envelope_familia / sal0_salgado / ...)
  veredicto  VARCHAR(10)  NULL,      -- ok | erro | incerto
  campos     JSON         NULL,      -- campos suspeitos [{campo, valor, valor_tipico, motivo}]
  confianca  FLOAT        NULL,
  resumo     VARCHAR(500) NULL,
  modelo     VARCHAR(60)  NULL,
  criado_em  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_veredicto (veredicto),
  INDEX idx_familia (familia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

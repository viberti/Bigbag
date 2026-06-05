-- Migração 006 — histórico de conversa por utilizador. Dá memória à consulta:
-- os seguimentos ("e no Lidl?") passam a ter contexto, e a conversa persiste
-- entre sessões.

CREATE TABLE mensagem (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  utilizador  VARCHAR(60) NOT NULL,           -- id do utilizador (portão/OAuth)
  papel       VARCHAR(12) NOT NULL,           -- 'user' | 'assistant'
  conteudo    TEXT NOT NULL,
  criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_msg_user (utilizador, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

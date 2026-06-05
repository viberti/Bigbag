-- Migração 007 — memória de longo prazo: perfil do usuário.
-- Fatos/preferências duráveis (dieta, loja preferida, agregado…) que o
-- assistente aprende e usa para personalizar. Distinto de `mensagem` (conversa).

CREATE TABLE perfil (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  utilizador  VARCHAR(60)  NOT NULL,
  fato        VARCHAR(300) NOT NULL,
  criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_perfil (utilizador, fato),
  KEY idx_perfil_user (utilizador)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

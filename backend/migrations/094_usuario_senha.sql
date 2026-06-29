-- 094: auth PRÓPRIA (substitui o Zitadel). Guarda o hash scrypt da senha e o nome do utilizador
-- na tabela `usuario` (que já tinha email PK + pais/locale). O login (POST /api/auth/login) verifica
-- a senha e emite o nosso JWT. Só entram utilizadores com senha_hash definida (scripts/set_senha.mjs).
ALTER TABLE usuario
  ADD COLUMN senha_hash VARCHAR(255) NULL,
  ADD COLUMN nome       VARCHAR(120) NULL;

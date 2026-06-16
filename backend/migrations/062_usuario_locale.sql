-- 062 — Camada PREÇO+LOCALE por país (Visao_Multi_Pais): cada utilizador tem um PAÍS,
-- que decide moeda + fontes de preço + (futuro) parsing de talão. A IDENTIDADE (por EAN)
-- continua partilhada. Aditiva. O país resolve-se por email na auth (default 'PT').
CREATE TABLE IF NOT EXISTS usuario (
  email      VARCHAR(160) NOT NULL PRIMARY KEY,
  pais       CHAR(2)      NOT NULL DEFAULT 'PT',   -- ISO-3166-1 alpha-2: PT, BR, …
  locale     VARCHAR(5)   NOT NULL DEFAULT 'pt-BR',-- idioma da UI/respostas (base pt-BR)
  criado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- utilizadores conhecidos (idempotente; o dono pode mudar com UPDATE).
INSERT INTO usuario (email, pais) VALUES
  ('gviberti3@gmail.com', 'PT'),
  ('suerocha@gmail.com',  'PT')
ON DUPLICATE KEY UPDATE email = email;

-- 088 — receitas importadas da internet (partilhar link → BigBag extrai e guarda).
-- Núcleo: identidade por (utilizador, url). Campos opcionais (o que se conseguir extrair); o
-- `bruto` guarda texto/descrição capturado quando a extração estruturada falha (nunca perder a fonte).
CREATE TABLE IF NOT EXISTS receita_importada (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  utilizador    VARCHAR(160) NOT NULL,
  url           VARCHAR(900) NOT NULL,
  fonte         VARCHAR(160) NULL,            -- domínio da origem
  nome          VARCHAR(300) NULL,
  foto          VARCHAR(900) NULL,
  ingredientes  JSON NULL,                    -- array de strings
  preparo       MEDIUMTEXT NULL,              -- modo de preparo (passos por linha)
  tempo         VARCHAR(60) NULL,
  porcoes       VARCHAR(60) NULL,
  via           VARCHAR(24) NULL,             -- jsonld | og+llm | og | erro
  bruto         MEDIUMTEXT NULL,              -- descrição/texto capturado (fallback)
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_url (utilizador, url(300)),
  KEY idx_user_data (utilizador, criado_em)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

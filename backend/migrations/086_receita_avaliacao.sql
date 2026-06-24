-- 086 — avaliações de receitas (👍/👎) por utilizador. As que GOSTOU (voto=1) acumulam-se e
-- alimentam o prompt de sugestão de novas receitas (aprende o gosto). Aditiva, só app_bigbag.
CREATE TABLE IF NOT EXISTS receita_avaliacao (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  utilizador    VARCHAR(160) NOT NULL,
  nome          VARCHAR(200) NOT NULL,
  nome_norm     VARCHAR(200) NOT NULL,           -- normalizado p/ dedup
  voto          TINYINT      NOT NULL,           -- 1 gostei · -1 não gostei
  descricao     VARCHAR(300) NULL,
  ingredientes  JSON         NULL,               -- "usa" — para aprender o estilo
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_receita (utilizador, nome_norm),
  KEY idx_user_voto (utilizador, voto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 076 — Enriquecimento oficial ANVISA (Dados Abertos: DADOS_ABERTOS_MEDICAMENTOS).
-- Fonte autoritativa da CATEGORIA REGULATÓRIA (Genérico/Similar/Novo/Específico/
-- Biológico/Fitoterápico/...) e do PRINCÍPIO ATIVO, por NÚMERO DE REGISTRO de produto
-- (9 dígitos). Casa com o nosso CMED por LEFT(medicamento.registro, 9). O dataset NÃO
-- tem EAN — a ponte é o registro-produto. Carga: scripts/carregar_anvisa.mjs.
-- Aditiva (CREATE + ADD COLUMN, sem perda de dados), só app_bigbag.

CREATE TABLE IF NOT EXISTS anvisa_registro (
  registro9          CHAR(9)      NOT NULL,
  categoria          VARCHAR(40)  NULL,
  principio_ativo    VARCHAR(400) NULL,
  classe_terapeutica VARCHAR(255) NULL,
  nome_produto       VARCHAR(300) NULL,
  situacao           VARCHAR(40)  NULL,
  atualizado_em      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (registro9),
  KEY idx_anvisa_cat (categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE medicamento
  ADD COLUMN categoria_anvisa VARCHAR(40)  NULL,
  ADD COLUMN principio_ativo  VARCHAR(400) NULL;

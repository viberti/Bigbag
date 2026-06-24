-- 084 — SINAL de programa de laboratório (postura 2), por EAN × fonte × programa. Camada QUALITATIVA:
-- "tem programa X (Lilly/NovoDia/…) nesta farmácia para este EAN" — SEM número. O VLM (captura visual,
-- tarefa seguinte) só DETECTA existência+nome; nunca preço nem percentual. Esta tabela NÃO toca preço.
-- Aditiva, só app_bigbag. Detalhe do desenho: docs/Captura_Visual_Programa_Lab_Proposta.md.
--
-- VALIDAÇÃO obrigatória antes de virar sinal (estado_validacao): estruturado/texto → VALIDADO imediato;
-- só-VLM → exige >=2 capturas consecutivas (confirmacoes>=2). FRESCOR/EXPIRAÇÃO: expira_em =
-- ultima_confirmacao + 14 DIAS (decisão do dono) — a re-confirmação implícita diária (fpVisual igual
-- renova de graça) + 2 ciclos full-scan semanais de folga; assimetria de erro favorece não deixar de
-- sinalizar. percentual_indicativo fica NULL desde já: porta para a camada de regras curadas, SEM migração.

CREATE TABLE IF NOT EXISTS programa_sinal (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ean                   VARCHAR(14)  NOT NULL,
  fonte                 VARCHAR(40)  NOT NULL,
  programa_detectado    VARCHAR(80)  NULL,                 -- 'Lilly' | 'NovoDia' | 'Desconto de Laboratório' | …
  presente              TINYINT      NOT NULL DEFAULT 0,    -- selo presente na última captura BOA
  percentual_indicativo DECIMAL(5,2) NULL,                 -- SEMPRE NULL agora; porta p/ regras curadas (sem migração)
  -- proveniência
  fonte_sinal           ENUM('vlm','html_estruturado','html_texto') NOT NULL,
  modelo_vlm            VARCHAR(60)  NULL,                  -- ex.: google/gemini-2.5-flash
  shot_hash             CHAR(16)     NULL,                  -- fpVisual da captura que gerou o sinal (liga ao cache)
  -- validação
  estado_validacao      ENUM('DETECTADO','VALIDADO','NAO_CORROBORADO','EXPIRADO') NOT NULL DEFAULT 'DETECTADO',
  confirmacoes          INT          NOT NULL DEFAULT 1,    -- nº de capturas consecutivas que viram o selo
  -- frescor / expiração (janela = 14 dias sobre ultima_confirmacao)
  detectado_em          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  validado_em           DATETIME     NULL,
  ultima_confirmacao    DATETIME     NULL,                  -- última captura BOA que re-confirmou o selo
  expira_em             DATETIME     NULL,                  -- ultima_confirmacao + 14d (escrito pelo script)
  atualizado_em         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ean_fonte_prog (ean, fonte, programa_detectado),
  KEY idx_estado_exp (estado_validacao, expira_em),
  KEY idx_ean_fonte (ean, fonte)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

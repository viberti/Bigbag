-- 065: fila de vetorização em fundo ("falha hoje, acerta amanhã", dono 2026-06-16).
-- Quando o download da imagem de um candidato OFF dá timeout no caminho SÍNCRONO do
-- acharGemeo, em vez de desistir enfileira-se aqui; um worker em fundo baixa com calma
-- (timeout largo, várias tentativas), vetoriza e faz upsert no Qdrant. Idempotente (ean PK).
CREATE TABLE IF NOT EXISTS fila_vetorizar (
  ean           VARCHAR(14)  NOT NULL PRIMARY KEY,
  imagem_url    TEXT         NOT NULL,
  fonte         VARCHAR(32)  NULL,
  tentativas    INT          NOT NULL DEFAULT 0,
  ultimo_erro   VARCHAR(255) NULL,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processado_em DATETIME     NULL,
  KEY ix_pendente (processado_em, tentativas, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

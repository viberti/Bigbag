-- 077 — Cache da explicação "em linguagem simples" de um medicamento (gerada por LLM,
-- fundamentada no PRINCÍPIO ATIVO + classe terapêutica — NÃO no texto da bula, que está
-- atrás de WAF). Chaveada pela substância (mesma explicação serve todas as marcas/
-- genéricos/EANs do mesmo ativo). Conteúdo estável → gera 1× por ativo, reusa sempre.
-- Aditiva, só app_bigbag. INFORMAÇÃO, não aconselhamento médico (disclaimers no texto).

CREATE TABLE IF NOT EXISTS medicamento_explicacao (
  chave           VARCHAR(190) NOT NULL,   -- substância normalizada (UPPER, espaços colapsados)
  substancia      VARCHAR(300) NULL,
  para_que_serve  TEXT NULL,
  como_usar       TEXT NULL,
  cuidados        TEXT NULL,
  modelo          VARCHAR(60)  NULL,
  gerado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

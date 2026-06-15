-- categoria_ancora: a PONTE (string de categoria externa → nossa FAMÍLIA). O conjunto
-- FINITO de categorias de loja/OFF mapeado para a nossa árvore (docs/Classificacao_Fusor.md
-- §5). Bootstrap determinístico (familiasQueCasam sobre a string) + resíduo p/ LLM/operador.
-- via: 'determinista' (1 família casou) | 'ambiguo' (composta, 2+) | 'sem_familia' (0:
-- fora do ramo OU por mapear) | 'llm' | 'operador'. Construída por
-- scripts/construir_categoria_ancora.mjs. Aditiva e reconstruível.
CREATE TABLE IF NOT EXISTS categoria_ancora (
  fonte             VARCHAR(40)  NOT NULL,
  categoria_norm    VARCHAR(200) NOT NULL,   -- norm(categoria)
  categoria_exemplo VARCHAR(255),            -- a grafia original
  familia           VARCHAR(60)  NULL,       -- slug da nossa família (FAMILIAS) ou null
  via               VARCHAR(16)  NOT NULL DEFAULT 'determinista',
  n                 INT          NOT NULL DEFAULT 0,  -- nº de produtos com essa categoria (peso)
  atualizado        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fonte, categoria_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

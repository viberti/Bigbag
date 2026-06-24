-- 085 — CLASSIFICAÇÃO canónica por EAN (secção de arrumação + nome PT) vinda do LLM, para corrigir
-- itens mal-classificados/estrangeiros na despensa e MELHORAR A BASE (reusável por toda a app).
-- Preenchida sob demanda ao abrir a despensa (lote barato). Aditiva, só app_bigbag.
CREATE TABLE IF NOT EXISTS ean_classificacao (
  ean           VARCHAR(20)  NOT NULL PRIMARY KEY,
  seccao        VARCHAR(24)  NULL,        -- da lista FECHADA: frutas/carne/.../condimentos/cafe_cha/...
  nome_pt       VARCHAR(200) NULL,        -- nome PT sugerido (espelho do que foi p/ produto_ean.nome)
  via           VARCHAR(16)  NOT NULL DEFAULT 'llm',
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

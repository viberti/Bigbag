-- 070 — nutricao_taco: Tabela Brasileira de Composição de Alimentos (TACO/NEPA-UNICAMP,
-- 597 alimentos GENÉRICOS por 100g). Fonte AUTORITATIVA e GRÁTIS de nutrição de genéricos
-- (arroz, feijão, frango, frutas…) — preenche o que o OFF/retalho BR não cobre (só ~13%).
-- `busca` = descrição tokenizada (sem acentos, singular, sem preparação) p/ match por nome.
-- Carregada por scripts/carregar_taco.mjs (de backend/data/taco.json). Reconstruível.
CREATE TABLE IF NOT EXISTS nutricao_taco (
  id        INT UNSIGNED NOT NULL PRIMARY KEY,  -- id do alimento na TACO
  descricao VARCHAR(255) NOT NULL,              -- "Arroz, integral, cozido"
  categoria VARCHAR(80),                        -- "Cereais e derivados"
  nutricao  JSON NOT NULL,                      -- por 100g {energia_kcal,proteina,gordura,gordura_saturada,hidratos,fibra,sal,acucares}
  busca     VARCHAR(255) NOT NULL,              -- tokens normalizados p/ o matcher
  FULLTEXT ft_busca (busca)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

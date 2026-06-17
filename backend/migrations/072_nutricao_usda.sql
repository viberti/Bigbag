-- 072 — nutricao_usda: USDA SR Legacy (FoodData Central), por 100g. DOMÍNIO PÚBLICO (obra do
-- governo dos EUA — licença a mais limpa de todas). ~6,5k alimentos GENÉRICOS (itens de marca e
-- categorias US-específicas — fast food, restaurante, baby food — filtrados na extração). 3.º nível
-- do matcher de genéricos: TACO (BR) > FAO (peixes/leguminosas) > USDA (cauda longa). `nome_en`
-- guarda o nome original (atribuição); `descricao` é o nome PT traduzido. Reconstruível.
CREATE TABLE IF NOT EXISTS nutricao_usda (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fonte     VARCHAR(16) NOT NULL,                 -- 'usda'
  descricao VARCHAR(255) NOT NULL,                -- nome PT (ex.: "Manteiga com sal")
  nome_en   VARCHAR(255),                         -- nome USDA original (atribuição)
  nutricao  JSON NOT NULL,                        -- por 100g {energia_kcal,proteina,gordura,gordura_saturada,hidratos,fibra,sal,acucares}
  busca     VARCHAR(255) NOT NULL,                -- tokens normalizados do nome PT
  FULLTEXT ft_busca (busca)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

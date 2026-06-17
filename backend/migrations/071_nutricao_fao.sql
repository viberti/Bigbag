-- 071 — nutricao_fao: bases globais FAO/INFOODS (uFiSh peixes + uPulses leguminosas), por 100g.
-- COMPLEMENTA a TACO (que tem prioridade no que é BR-específico): tapa pescados (a TACO cobre mal)
-- e leguminosas (grão-de-bico, lentilha, feijões não-BR). Licença CC BY-NC-ND? NÃO — CC BY-NC-SA
-- 3.0 IGO (permite cópia/adaptação não-comercial com atribuição ao FAO/INFOODS). `nome_en` guarda
-- o nome original p/ atribuição/auditoria; `descricao` é o nome PT traduzido (matcher). Reconstruível.
CREATE TABLE IF NOT EXISTS nutricao_fao (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fonte     VARCHAR(16) NOT NULL,                 -- 'ufish' | 'upulses'
  descricao VARCHAR(255) NOT NULL,                -- nome PT (ex.: "Tilápia", "Grão-de-bico")
  nome_en   VARCHAR(255),                         -- nome FAO original (atribuição)
  nutricao  JSON NOT NULL,                        -- por 100g {energia_kcal,proteina,gordura,gordura_saturada,hidratos,fibra,sal,acucares}
  busca     VARCHAR(255) NOT NULL,                -- tokens normalizados do nome PT
  FULLTEXT ft_busca (busca)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

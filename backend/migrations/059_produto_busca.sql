-- Índice de BUSCA por nome (autocomplete da lista + nutrição), 2026-06-15.
-- Materializado a partir do catálogo PT-comprável (Continente/Auchan/PingoDoce/Lidl-PT
-- + Mercadona-ES/Lidl-FR traduzidos), deduplicado, ~dezenas de milhares. NÃO é o
-- off_full (4,5M, multilíngue) — esse fica só p/ enriquecimento por EAN.
-- Reconstruído por scripts/construir_produto_busca.mjs (TRUNCATE + rebuild).
-- FULLTEXT(nome,marca) → busca indexada com ranking (sem LIKE); settings globais
-- do FULLTEXT não tocadas (min_token_size=3, partilhado com pitacos.ai/1417).
CREATE TABLE IF NOT EXISTS produto_busca (
  id           bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  generico     tinyint NOT NULL DEFAULT 0,        -- 1 = genérico (topo da busca, negrito no UI)
  nome         varchar(255) NOT NULL,
  marca        varchar(120),
  tamanho      varchar(60),
  ean          varchar(20),                       -- NULL p/ genéricos e frescos sem EAN
  product_type varchar(10),                       -- food | non_food (alimento 1.º na lista)
  popularidade int NOT NULL DEFAULT 0,            -- vezes comprado/listado pela casa (desempate)
  tem_nutricao tinyint NOT NULL DEFAULT 0,        -- atalho p/ a busca de info nutricional
  KEY idx_generico (generico),
  KEY idx_ean (ean),
  FULLTEXT KEY ft_nome (nome, marca)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

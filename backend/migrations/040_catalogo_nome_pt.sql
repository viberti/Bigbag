-- Nome do produto traduzido para PT (experiência: catálogo Mercadona vem em ES,
-- e o token-overlap dos talões PT perdia para os catálogos PT — "MOZZARELLA" casa
-- "Queijo Mozzarella" (Auchan) e não "Queso Mozzarella" (Mercadona). Tradução por
-- léxico ES→PT em scripts/traduzir_mercadona.mjs; buscarCatalogo tokeniza nome_pt
-- quando existe. NULL = sem tradução (usa `nome`).
ALTER TABLE catalogo_produto ADD COLUMN nome_pt VARCHAR(255) NULL AFTER nome;

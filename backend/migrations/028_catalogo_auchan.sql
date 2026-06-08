-- Catálogo local de produtos do Auchan PT, obtido por scrape do JSON-LD da ficha
-- de cada produto. Fonte de EANs e de dados (nome/marca/categoria/preço/imagem)
-- para MARCAS NACIONAIS — matching offline contra os itens do talão, sem depender
-- de fotos/scan. robots-compliant: enumera pelos `sitemap_*-product.xml` e abre a
-- ficha (ambos PERMITIDOS); NUNCA usa `/pesquisa?q=` (Disallow no robots.txt).
-- Categoria vem do CAMINHO do URL (hierarquia completa) — o JSON-LD não a traz.
CREATE TABLE IF NOT EXISTS catalogo_auchan (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  sku_auchan     VARCHAR(24)  NOT NULL,                 -- id interno Auchan (JSON-LD sku / id do URL)
  ean            VARCHAR(20)  NULL,                     -- gtin13 do JSON-LD
  nome           VARCHAR(255) NOT NULL,
  marca          VARCHAR(140) NULL,
  categoria_path VARCHAR(300) NULL,                     -- 'alimentacao/mercearia/cereais-e-barras/cereais-crianca'
  categoria      VARCHAR(140) NULL,                     -- folha legível ('Cereais Crianca')
  cat_n1         VARCHAR(90)  NULL,
  cat_n2         VARCHAR(90)  NULL,
  cat_n3         VARCHAR(90)  NULL,
  cat_n4         VARCHAR(90)  NULL,
  formato        VARCHAR(60)  NULL,                     -- texto do formato detetado no nome
  unidade_base   VARCHAR(8)   NULL,                     -- kg | L | un
  formato_valor  DECIMAL(12,3) NULL,                    -- peso/volume na unidade base
  preco          DECIMAL(10,2) NULL,
  moeda          VARCHAR(4)   NULL DEFAULT 'EUR',
  preco_por_base DECIMAL(12,4) NULL,                    -- €/kg | €/L | €/un (calculado)
  url            VARCHAR(600) NOT NULL,
  imagem_url     VARCHAR(600) NULL,
  scraped_at     DATETIME     NULL,
  UNIQUE KEY uq_sku (sku_auchan),
  KEY idx_ean (ean),
  KEY idx_cat1 (cat_n1),
  KEY idx_catpath (categoria_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 074: histórico de preço do catálogo online (append-only) + seed com os preços atuais.
-- MUDANÇA DE MODELO das colheitas (decisão do dono 2026-06-20): o catálogo deixa de ser
-- SUBSTITUÍDO a cada colheita (DELETE+INSERT) e passa a ACUMULAR (UPSERT por (fonte,sku_fonte),
-- nunca apaga). O preço corrente fica em catalogo_produto; cada MUDANÇA de preço regista uma
-- linha aqui (o anterior não se perde). `scraped_at` em catalogo_produto = "visto pela última vez".
-- Aditiva: NÃO apaga nada.
CREATE TABLE IF NOT EXISTS catalogo_preco_hist (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fonte VARCHAR(16) NOT NULL,
  sku_fonte VARCHAR(24) NOT NULL,
  ean VARCHAR(14) NULL,
  preco DECIMAL(10,2) NOT NULL,
  moeda VARCHAR(3) NOT NULL DEFAULT 'BRL',
  preco_por_base DECIMAL(14,4) NULL,
  visto_em DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_fonte_sku (fonte, sku_fonte),
  KEY idx_ean (ean),
  KEY idx_visto (visto_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SEED: o preço atual de cada produto vira o 1.º ponto do histórico (não se perde o que já há).
INSERT INTO catalogo_preco_hist (fonte, sku_fonte, ean, preco, moeda, preco_por_base, visto_em)
  SELECT fonte, sku_fonte, ean, preco, moeda, preco_por_base, COALESCE(scraped_at, NOW())
  FROM catalogo_produto
  WHERE preco IS NOT NULL;

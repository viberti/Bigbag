-- Unifica o catálogo externo (Auchan + Continente + futuras fontes) numa só
-- tabela pesquisável. Generaliza `catalogo_auchan` → `catalogo_produto`, com
-- coluna `fonte` e `sku_fonte` (id interno DA fonte). Unicidade por (fonte, sku).
-- Não-destrutivo: preserva as 11 998 linhas do Auchan (fonte='auchan').
ALTER TABLE catalogo_auchan
  ADD COLUMN fonte VARCHAR(16) NOT NULL DEFAULT 'auchan' AFTER id,
  CHANGE COLUMN sku_auchan sku_fonte VARCHAR(24) NOT NULL,
  DROP INDEX uq_sku,
  ADD UNIQUE KEY uq_fonte_sku (fonte, sku_fonte),
  ADD KEY idx_fonte (fonte);
RENAME TABLE catalogo_auchan TO catalogo_produto;

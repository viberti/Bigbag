-- Classificação ALIMENTO vs NÃO-ALIMENTO persistente (Fase 2). Determinística
-- (src/normaliza/tipoProduto.js); backfill em scripts/backfill_product_type.mjs.
-- Aditiva (coluna nulável + índice). Valores: 'food' | 'non_food' | NULL (ambíguo).
ALTER TABLE catalogo_produto
  ADD COLUMN product_type VARCHAR(10) NULL,
  ADD KEY idx_product_type (product_type);

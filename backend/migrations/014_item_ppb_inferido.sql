-- preco_por_base INFERIDO pela auto-correção de outliers (não lido do recibo).
-- Quando o ppb está MUITO fora da mediana do SKU e a divisão por um pack
-- plausível (÷6, ÷12…) o traz de volta à faixa, gravamos o valor corrigido e
-- marcamos ppb_inferido=1 — honesto (distinto de dado lido) e reversível.
-- O recompute (ppb.js) NÃO sobrescreve itens inferidos.
ALTER TABLE item ADD COLUMN ppb_inferido TINYINT(1) NOT NULL DEFAULT 0 AFTER preco_por_base;

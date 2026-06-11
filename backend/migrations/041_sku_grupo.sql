-- B1 — categoria com vocabulário FECHADO: grupo de alto nível do SKU (11 valores,
-- normaliza/categoria.js), calculado deterministicamente das fontes (food_groups
-- do OFF → categoria texto → nome). Substitui o remendo por keywords no frontend.
ALTER TABLE sku_normalizado ADD COLUMN grupo VARCHAR(16) NULL AFTER categoria;

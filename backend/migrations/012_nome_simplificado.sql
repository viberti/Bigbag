-- Migração 012 — "nome simplificado": agrupamento de nível acima do canónico,
-- bom para lista de compras. Vários SKUs canónicos partilham o mesmo simplificado
-- (ex.: "Leite Meio Gordo", "Leite UHT Magro" → "Leite"; "Pera Rocha",
-- "Pera Conference" → "Pera"). Preenchido à mão pelo operador no /admin
-- (difícil de automatizar com fiabilidade).
ALTER TABLE sku_normalizado ADD COLUMN nome_simplificado VARCHAR(120) NULL AFTER nome_canonico;

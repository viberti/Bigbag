-- 050 — EAN no item da lista. Quando um item entra por SCAN, guardamos o código
-- de barras para ligar o item ao produto exato (preço de referência do catálogo,
-- ficha, etc.) sem depender de match por nome. NULL para itens escritos à mão.
-- Não-destrutivo: coluna nova, opcional.
ALTER TABLE lista_item ADD COLUMN ean VARCHAR(20) NULL AFTER nome;

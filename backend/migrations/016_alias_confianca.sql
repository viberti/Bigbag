-- Confiança do mapeamento descrição→SKU, guardada NO ALIAS (durável por
-- descrição; sobrevive a reprocessos, ao contrário de a guardar no item).
-- Escala 0–100, atribuída na resolução:
--   100 = associação manual do operador / fusão
--    95 = (reservado)
--    90 = match por similaridade/exato
--    75 = match confirmado por juiz LLM
--    60 = SKU novo criado
-- NULL = legado (antes desta coluna) — tratado como "a rever" na worklist.
ALTER TABLE sku_alias ADD COLUMN confianca TINYINT NULL AFTER origem;

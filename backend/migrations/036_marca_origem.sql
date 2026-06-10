-- A4 (Analise_Fontes §3.2) — proveniência da marca do SKU: sem isto, marca LIDA
-- do talão e marca ADIVINHADA pelo LLM são indistinguíveis na base (e a UI não
-- pode ser honesta sobre o que é inferido).
-- Valores: marcador (CNT/PD/ARO no nome) | gazetteer (marca impressa reconhecida
-- no dicionário do catálogo) | catalogo (via match de nome) | ean (da ficha) |
-- prior (marca-própria por cadeia) | llm (palpite da canonicalização) | manual.
-- NULL = anterior a esta migração (proveniência desconhecida).
ALTER TABLE sku_normalizado ADD COLUMN marca_origem VARCHAR(12) NULL AFTER marca;

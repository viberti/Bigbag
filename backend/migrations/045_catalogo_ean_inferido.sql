-- 045 — EAN INFERIDO no catálogo (matching catálogo↔catálogo).
--
-- Fontes sem EAN (Pingo Doce: o site não o expõe) podem herdá-lo de fontes COM
-- EAN (Auchan/Continente) por matching determinístico marca+nome — nomes de
-- catálogo são completos, sem as abreviaturas do talão (medido 2026-06-11:
-- 2.388 matches únicos confiantes, cobertura de tokens ≥80%, 1 só EAN).
--
-- Coluna SEPARADA do `ean` de propósito (proveniência): `ean` = o que a fonte
-- deu; `ean_inferido` = herdado por matching, pode ser o produto certo noutro
-- TAMANHO (o PD não publica tamanhos → variantes de gramagem têm outro EAN).
-- Quem consome decide o peso; identidade forte continua a passar pelo operador.
ALTER TABLE catalogo_produto
  ADD COLUMN ean_inferido VARCHAR(14) NULL AFTER ean,
  ADD COLUMN ean_inferido_de VARCHAR(60) NULL AFTER ean_inferido;

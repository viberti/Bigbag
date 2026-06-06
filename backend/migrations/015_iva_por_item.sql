-- IVA por produto, como parte da semântica do item.
-- `item.taxa_iva`: a taxa de IVA do produto em decimal (0.060, 0.130, 0.230),
--   resolvida na extração a partir do código/letra no fim da linha + a legenda
--   no corpo da fatura. NULL se não determinável.
-- `fatura.precos_com_iva`: 1 = os preços das linhas JÁ incluem IVA (supermercados);
--   0 = preços SEM IVA, IVA somado no fim (cash-and-carry/grossista, ex. Makro).
-- Quando precos_com_iva=0, o preco_por_base é convertido para o preço FINAL
-- (× (1+taxa_iva)) para ser comparável com os supermercados.
ALTER TABLE item ADD COLUMN taxa_iva DECIMAL(4,3) NULL AFTER preco_por_base;
ALTER TABLE fatura ADD COLUMN precos_com_iva TINYINT(1) NOT NULL DEFAULT 1 AFTER desconto_global;

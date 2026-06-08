-- EAN-13 do artigo por LINHA de talão, quando o talão o imprime (cash-and-carry
-- como o Makro tem o "Nº Código Artigo" = EAN na 1.ª coluna). Permite identificar
-- o produto sem foto/scan. Validado pelo dígito verificador antes de gravar.
ALTER TABLE item ADD COLUMN ean VARCHAR(20) NULL AFTER descricao_original;
CREATE INDEX idx_item_ean ON item (ean);

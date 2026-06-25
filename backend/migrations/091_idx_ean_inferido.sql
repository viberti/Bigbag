-- 091 — índice em catalogo_produto.ean_inferido. A query da imagem/categoria do /info usa
-- WHERE (ean = ? OR ean_inferido = ?); sem índice no ean_inferido o OR caía em FULL SCAN de
-- ~621k linhas + ORDER BY → ~1,6s por consulta de produto. Com o índice, index_merge → milissegundos.
ALTER TABLE catalogo_produto ADD INDEX idx_ean_inferido (ean_inferido);

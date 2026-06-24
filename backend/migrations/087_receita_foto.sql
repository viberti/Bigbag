-- 087 — query de FOTO (palavras-chave do prato, em inglês) por receita avaliada, para a aba
-- "Guardadas" mostrar a mesma imagem da sugestão. Aditiva, só app_bigbag.
ALTER TABLE receita_avaliacao ADD COLUMN foto VARCHAR(120) NULL AFTER ingredientes;

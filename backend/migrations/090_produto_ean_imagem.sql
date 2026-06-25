-- 090 — URL da imagem na ficha por EAN (centralizar: o read deixa de ir ao catálogo/off_full
-- buscar a imagem a cada scan; o fusor escolhe-a uma vez e grava aqui). Aditiva, só app_bigbag.
ALTER TABLE produto_ean ADD COLUMN imagem_url VARCHAR(500) NULL AFTER off_json;

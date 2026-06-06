-- Guarda a linha de PESO de balcão ("X kg x Y €/kg") que o normalize.js separa
-- do nome (para a cache de alias agrupar). É preciso persisti-la para recomputar
-- o preco_por_base respeitando a unidade_base do SKU (Fase 1 da semântica de
-- produto). Não-destrutiva (ADD COLUMN).
ALTER TABLE item ADD COLUMN linha_peso VARCHAR(80) NULL AFTER descricao_original;

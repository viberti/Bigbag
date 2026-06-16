-- 068: `seq` monotónico na base_local, para a sync incremental apanhar CRESCIMENTO VIVO.
-- Decisão do dono (2026-06-17): qualquer EAN resolvido FORA do cliente (um miss, buscado no
-- servidor) passa a ser inserido na base_local partilhada (origem 'uso'), com nutrição/
-- ingredientes — vira HIT na próxima sync de TODOS os telefones ("cresce com o uso").
-- O cursor por `ean` NÃO servia: um EAN novo inserido com ean menor que o cursor do telefone
-- nunca seria descido. Um `seq` auto-incremental resolve: o telefone pede `seq > último` e
-- apanha tudo o que entrou depois, seja qual for o ean. (Rebuild do bootstrap preserva 'uso'.)
ALTER TABLE base_local ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE KEY;

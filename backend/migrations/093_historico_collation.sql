-- 093: corrige a COLLATION da historico_produto. Foi criada com utf8mb4_0900_ai_ci (default do
-- MySQL 8) em vez de utf8mb4_unicode_ci (default da app_bigbag e de todas as outras tabelas). Isso
-- quebrava o GET /produto/consultados (página Histórico) com "Illegal mix of collations" ao comparar
-- produto_ean.ean (unicode_ci) = historico_produto.ean (0900) no subquery do nome.
-- NÃO-DESTRUTIVO: utf8mb4 → utf8mb4, só muda a regra de comparação/ordenação (sem conversão de bytes).
ALTER TABLE historico_produto CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

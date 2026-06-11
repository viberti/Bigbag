-- 048 — COLAÇÃO ÚNICA: catalogo_produto → utf8mb4_unicode_ci.
--
-- A base inteira (24 tabelas + default da BD) usa utf8mb4_unicode_ci; só a
-- catalogo_produto nasceu em utf8mb4_0900_ai_ci (criada sem colação explícita
-- numa sessão com o default do servidor). A diferença causou 3 bugs num só dia
-- ("Illegal mix of collations" em joins item.ean × catalogo: variantes da lista,
-- admin/match-eans, auditoria) — esta conversão elimina a CLASSE de erro.
-- Os COLLATE explícitos adicionados como remendo ficam no código (viram no-ops).
-- Não-destrutivo: conversão de charset/colação (rebuild da tabela, ~65k linhas).
ALTER TABLE catalogo_produto CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

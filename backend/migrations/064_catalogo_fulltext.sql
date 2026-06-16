-- 064 — FULLTEXT em catalogo_produto(nome, marca). A busca de GÉMEO por texto
-- (acharPorNomeMarca) passa a varrer TODAS as nossas fontes (lojas PT/ES/BR, Nutripédia,
-- harvests — todos os países) ALÉM do off_full. Antes só ia ao OFF → perdia gémeos que só
-- existem no nosso catálogo (ex.: um produto BR do savegnago, um PT do Continente).
-- Aditiva (só adiciona índice). min_token_size=3 global (partilhado) — não tocar.
ALTER TABLE catalogo_produto ADD FULLTEXT INDEX ft_nome_marca (nome, marca);

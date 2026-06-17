-- 069 — catalogo_produto.pdp_em: marcador "PDP já visitada" para o 2.º passo de
-- enriquecimento (página de produto → EAN + ingredientes + nutrição). NULL = por
-- visitar; data = visitada (mesmo que sem nutrição) → o backfill é idempotente/retomável
-- e não re-raspa produtos que simplesmente não têm tabela. Aditiva (coluna nullable,
-- ALTER instantâneo em MySQL 8). Hoje usada pelo paodeacucar; reutilizável p/ outras lojas.
ALTER TABLE catalogo_produto ADD COLUMN pdp_em TIMESTAMP NULL DEFAULT NULL;

-- Tracking do pipeline de match-por-imagem (2026-06-13): marca, por foto de
-- catálogo, quando foi BAIXADA para disco e quando foi VETORIZADA (embedding no
-- Qdrant). Torna o bulk reentrante e mensurável (quantas faltam). A foto vive em
-- /var/lib/bigbag/imagens/{id}.jpg (id = catalogo_produto.id); o vetor no Qdrant
-- (point_id = id). Nada disto entra no mysqldump pesado — são artefactos em disco.
ALTER TABLE catalogo_produto
  ADD COLUMN foto_em  TIMESTAMP NULL,   -- baixada p/ disco
  ADD COLUMN vetor_em TIMESTAMP NULL;   -- embedding gerado + inserido no Qdrant

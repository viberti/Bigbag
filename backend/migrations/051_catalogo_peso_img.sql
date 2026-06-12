-- 051 — Marcador da ferramenta "peso pela imagem". Muitos produtos Continente/Pingo
-- Doce ficam com formato "1un" (o peso não está no título, está na imagem). O job
-- lê o peso da imagem do CDN (pública) com o VLM e grava no formato. Esta coluna
-- regista que JÁ TENTÁMOS (com ou sem sucesso) → não repetir a chamada (custo).
--   peso_img_em NULL  = por tentar
--   peso_img_em data + formato preenchido  = peso veio da imagem
--   peso_img_em data + formato ainda "Nun" = tentei, a imagem não tinha o peso
-- Não-destrutivo: coluna nova, opcional.
ALTER TABLE catalogo_produto ADD COLUMN peso_img_em TIMESTAMP NULL;

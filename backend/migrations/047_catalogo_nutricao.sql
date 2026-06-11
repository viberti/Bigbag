-- 047 — NUTRIÇÃO oficial de loja no catálogo (descoberta 2026-06-11).
--
-- As páginas do AUCHAN trazem a tabela nutricional COMPLETA no HTML estático
-- (Energia kJ/kcal, Lípidos, saturados, Hidratos, açúcares, Proteínas, Sal),
-- com a base declarada ("Valores Nutricionais por: 100 Gramas") + Ingredientes
-- com alergénios em MAIÚSCULAS (rotulagem UE). São ~12k produtos COM EAN —
-- nutrição oficial para cruzar por EAN exatamente onde o OFF é fraco (dump com
-- nutrição em só 16% das linhas; marcas próprias fora do OFF).
-- (O Continente também a tem no site, mas carrega por JS — não capturável sem
-- arriscar o anti-bot. O Pingo Doce não a publica.)
ALTER TABLE catalogo_produto
  ADD COLUMN nutricao JSON NULL,
  ADD COLUMN nutricao_base VARCHAR(80) NULL,
  ADD COLUMN ingredientes TEXT NULL;

-- 044 — Alargar colunas de produto_ean que rebentavam o INSERT da ficha.
--
-- BUG: a identificação por foto/EAN (/api/produto/identificar) e o enriquecimento
-- por OFF falhavam silenciosamente com "Data too long for column 'categoria'":
-- o OFF devolve a hierarquia COMPLETA de categorias (ex.: o kefir Milbona vinha
-- com 181 chars: "Boissons...,Produits laitiers fermentés,...,Kéfir") e a coluna
-- era varchar(120). O erro abortava o INSERT inteiro → a ficha (EAN+OFF+VLM)
-- perdia-se, sobravam só as fotos no disco. Truncar a 120 seria pior: a string vai
-- do geral→específico, cortar no fim apagava o nível mais útil ("Kéfir").
--
-- Idem para `validade` (varchar(30)): o VLM às vezes devolve texto mais longo.
--
-- ALTER NÃO-destrutivo (só alarga) sobre app_bigbag (BD do projeto).
ALTER TABLE produto_ean
  MODIFY COLUMN categoria VARCHAR(255) NULL,
  MODIFY COLUMN validade  VARCHAR(60)  NULL;

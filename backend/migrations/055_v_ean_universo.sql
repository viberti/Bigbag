-- VISTA do UNIVERSO de EANs (a "tabela auxiliar com todos os EANs" — dono,
-- 2026-06-13). Une os EANs distintos das fontes numa só superfície, com flags de
-- presença por área + lista de fontes do catálogo + se tem foto (denominador da
-- vetorização de imagens). Zero manutenção (vista, sempre fresca); aditiva.
--   uso analítico: SELECT COUNT(*) FROM v_ean_universo;  (universo total)
--                  SELECT SUM(em_off AND NOT em_catalogo) ... (só-OFF), etc.
-- NB: para RESOLVER um EAN (ficha), usar fundirFichaEan — esta vista é o mapa/
-- denominador (o GROUP BY materializa; não é para lookup quente por EAN).
CREATE OR REPLACE VIEW v_ean_universo AS
SELECT
  ean,
  MAX(em_catalogo) AS em_catalogo,
  MAX(em_off)      AS em_off,
  MAX(em_fiche)    AS em_fiche,
  MAX(em_talao)    AS em_talao,
  MAX(tem_foto)    AS tem_foto,
  NULLIF(GROUP_CONCAT(DISTINCT fonte_cat ORDER BY fonte_cat SEPARATOR ','), '') AS fontes_catalogo,
  (MAX(em_catalogo) + MAX(em_off) + MAX(em_fiche) + MAX(em_talao)) AS n_areas
FROM (
  SELECT ean, 1 AS em_catalogo, 0 AS em_off, 0 AS em_fiche, 0 AS em_talao,
         CASE WHEN imagem_url IS NOT NULL AND imagem_url <> '' THEN 1 ELSE 0 END AS tem_foto,
         fonte AS fonte_cat
    FROM catalogo_produto WHERE ean IS NOT NULL AND ean <> ''
  UNION ALL
  SELECT ean, 0, 1, 0, 0, 0, NULL FROM off_produto    WHERE ean IS NOT NULL AND ean <> ''
  UNION ALL
  SELECT ean, 0, 0, 1, 0, 0, NULL FROM produto_ean    WHERE ean IS NOT NULL AND ean <> ''
  UNION ALL
  SELECT ean, 0, 0, 0, 1, 0, NULL FROM item           WHERE ean IS NOT NULL AND ean <> ''
) u
GROUP BY ean;

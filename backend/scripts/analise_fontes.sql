-- Levantamento das fontes de informação de produto (read-only)
SELECT '== ITENS (talão) ==' AS '';
SELECT COUNT(*) AS itens_total,
       COUNT(DISTINCT descricao_original) AS descricoes_distintas,
       SUM(sku_id IS NOT NULL) AS com_sku,
       SUM(ean IS NOT NULL) AS com_ean_linha,
       SUM(is_non_product=1) AS nao_produto
  FROM item;
SELECT l.cadeia, COUNT(*) AS itens, COUNT(DISTINCT i.descricao_original) AS descr_dist,
       SUM(i.ean IS NOT NULL) AS com_ean
  FROM item i JOIN fatura f ON f.id=i.fatura_id JOIN loja l ON l.id=f.loja_id
 GROUP BY l.cadeia ORDER BY itens DESC;

SELECT '== SKU (canónico) ==' AS '';
SELECT COUNT(*) AS skus,
       SUM(marca IS NOT NULL AND marca<>'') AS com_marca,
       SUM(categoria IS NOT NULL AND categoria<>'') AS com_categoria,
       SUM(nome_simplificado IS NOT NULL AND nome_simplificado<>'') AS com_simplificado,
       SUM(formato_valor IS NOT NULL AND formato_valor<>1) AS com_formato_real
  FROM sku_normalizado;
SELECT COUNT(DISTINCT categoria) AS categorias_distintas_sku FROM sku_normalizado WHERE categoria IS NOT NULL AND categoria<>'';
SELECT categoria, COUNT(*) n FROM sku_normalizado WHERE categoria IS NOT NULL AND categoria<>'' GROUP BY categoria ORDER BY n DESC LIMIT 15;

SELECT '== sku_alias (talão→SKU) ==' AS '';
SELECT COUNT(*) AS aliases, COUNT(DISTINCT sku_id) AS skus_com_alias FROM sku_alias;

SELECT '== produto_ean (fichas) ==' AS '';
SELECT fonte, COUNT(*) n,
       SUM(off_json IS NOT NULL) AS com_off,
       SUM(vlm_json IS NOT NULL) AS com_vlm,
       SUM(nutricao IS NOT NULL) AS com_nutricao,
       SUM(categoria IS NOT NULL AND categoria<>'') AS com_categoria,
       SUM(marca IS NOT NULL AND marca<>'') AS com_marca
  FROM produto_ean GROUP BY fonte WITH ROLLUP;

SELECT '== produto_nome (variantes por EAN) ==' AS '';
SELECT origem, COUNT(*) n, COUNT(DISTINCT ean) eans FROM produto_nome GROUP BY origem WITH ROLLUP;
SELECT ROUND(AVG(v),1) AS variantes_medias_por_ean, MAX(v) AS max_variantes
  FROM (SELECT ean, COUNT(*) v FROM produto_nome GROUP BY ean) t;

SELECT '== catalogo_produto (scrape) ==' AS '';
SELECT fonte, COUNT(*) n,
       SUM(marca IS NOT NULL AND marca<>'') AS com_marca,
       SUM(categoria_path IS NOT NULL AND categoria_path<>'') AS com_cat_path,
       SUM(preco IS NOT NULL) AS com_preco
  FROM catalogo_produto GROUP BY fonte WITH ROLLUP;
SELECT COUNT(DISTINCT cp.ean) AS eans_catalogo_que_ja_temos_em_fichas
  FROM catalogo_produto cp JOIN produto_ean pe ON pe.ean = cp.ean;

SELECT '== produto_generico (frescos/típica) ==' AS '';
SELECT tipo, COUNT(*) n, SUM(nutricao IS NOT NULL) com_nutricao FROM produto_generico GROUP BY tipo WITH ROLLUP;

SELECT '== match_ean_sugestao (juiz) ==' AS '';
SELECT estado, COUNT(*) n FROM match_ean_sugestao GROUP BY estado WITH ROLLUP;

SELECT '== nome_sugestao ==' AS '';
SELECT estado, COUNT(*) n FROM nome_sugestao GROUP BY estado WITH ROLLUP;

SELECT '== COBERTURA EAN dos itens ==' AS '';
SELECT
  (SELECT COUNT(DISTINCT i.descricao_original) FROM item i WHERE i.is_non_product=0) AS descr_produto,
  (SELECT COUNT(DISTINCT i.descricao_original) FROM item i WHERE i.is_non_product=0 AND i.ean IS NOT NULL) AS descr_com_ean_direto,
  (SELECT COUNT(DISTINCT pn.nome) FROM produto_nome pn) AS nomes_conhecidos_por_ean;

SELECT '== Categoria nas 3 fontes (amostras) ==' AS '';
SELECT categoria, COUNT(*) n FROM produto_ean WHERE categoria IS NOT NULL AND categoria<>'' GROUP BY categoria ORDER BY n DESC LIMIT 10;
SELECT SUBSTRING_INDEX(categoria_path,'>',1) AS nivel1, COUNT(*) n FROM catalogo_produto WHERE categoria_path IS NOT NULL AND categoria_path<>'' GROUP BY nivel1 ORDER BY n DESC LIMIT 12;

SELECT '== produto_mestre / categoria_nutricao ==' AS '';
SELECT (SELECT COUNT(*) FROM produto_mestre) AS mestres, (SELECT COUNT(*) FROM categoria_nutricao) AS cat_nutricao;

SELECT '== Itens cujo SKU não tem categoria ==' AS '';
SELECT COUNT(*) AS itens_sem_categoria_via_sku
  FROM item i JOIN sku_normalizado s ON s.id=i.sku_id
 WHERE i.is_non_product=0 AND (s.categoria IS NULL OR s.categoria='');

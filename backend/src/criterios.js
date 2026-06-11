// Critério ÚNICO de "produto por identificar" (precisa de foto/ficha).
//
// Partilhado pela worklist da app (`/produto/por-identificar`) e pelo flag +
// contagem do painel do operador (admin). Antes estavam DUPLICADOS e divergiram:
// um item com EAN na linha mas SEM ficha (ex.: "BIO KEFIR NATURAL" do Lidl, cujo
// EAN não está no OFF) mostrava o ícone de câmara no detalhe da nota mas NÃO
// aparecia na worklist. Centralizar aqui garante que as superfícies concordam.
//
// Mesma definição do `tem_dados` no detalhe da nota (faturas.js): um item está
// IDENTIFICADO quando tem ficha COM DADOS — nutrição no genérico (pg.nutricao),
// ficha OFF/VLM para a mesma descrição+cadeia, ou o EAN da própria linha já com
// ficha. Ter só um EAN na linha, SEM ficha, NÃO conta como identificado.
//
// NÃO-ALIMENTAR (grupo 'higiene' — limpeza, parafarmácia) sai: a worklist é para
// ganhar ficha de NUTRIÇÃO/saúde, e estes não têm nutrição por natureza (lixívia,
// colírio). "Tem dados" inclui também `nutricao` (não só off/vlm): a nutrição
// oficial de loja (catálogo Auchan, 047) conta como identificado.
// Pressupõe os aliases: i (item), pg (produto_generico), l (loja), s (sku_normalizado).
export const POR_IDENTIFICAR_SQL = `(
  i.is_non_product = 0
  AND (pg.tipo IS NULL OR pg.tipo <> 'fresco')
  AND pg.nutricao IS NULL
  AND (s.grupo IS NULL OR s.grupo <> 'higiene')
  AND NOT EXISTS (
    SELECT 1 FROM produto_ean pe
      JOIN item i2 ON i2.id = pe.item_id
      JOIN fatura f2 ON f2.id = i2.fatura_id
      JOIN loja l2 ON l2.id = f2.loja_id
     WHERE (pe.off_json IS NOT NULL OR pe.vlm_json IS NOT NULL OR pe.nutricao IS NOT NULL)
       AND i2.descricao_original = i.descricao_original
       AND COALESCE(l2.cadeia, l2.nome) = COALESCE(l.cadeia, l.nome))
  AND NOT EXISTS (
    SELECT 1 FROM produto_ean pe0
     WHERE pe0.ean = i.ean
       AND (pe0.off_json IS NOT NULL OR pe0.vlm_json IS NOT NULL OR pe0.nutricao IS NOT NULL))
)`;

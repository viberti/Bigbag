-- 073 — quantidade por PESO/MEDIDA na lista de compras (user-driven). ADITIVA, sem tocar em
-- `quantidade` (fica INT, contagem). `unidade` = modo de PEDIDO gravado ('kg'|'g'|'L'|'ml'|NULL=conta);
-- `qtd_medida` = quantidade fracionária quando unidade != NULL (ex.: 0.300 kg, 1.5 L). Linhas antigas
-- ficam unidade=NULL → contagem idêntica a hoje. NÃO confundir com sku_normalizado.unidade_base
-- (ENUM, eixo de COMPARAÇÃO de preço): aqui é o eixo de PEDIDO, distinto.
ALTER TABLE lista_item
  ADD COLUMN unidade    VARCHAR(4)    NULL,
  ADD COLUMN qtd_medida DECIMAL(8,3)  NULL;

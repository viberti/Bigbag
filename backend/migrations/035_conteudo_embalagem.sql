-- Conteúdo da embalagem ESTRUTURADO na ficha do produto (Analise_Fontes §3.1 / A1).
-- Um EAN implica embalagem fixa: o conteúdo (1 kg · 1 L · 18 un · 6×1L) é propriedade
-- do PRODUTO. Parseado do texto livre `quantidade` (que se mantém como fonte).
ALTER TABLE produto_ean
  ADD COLUMN conteudo_valor DECIMAL(10,3) NULL AFTER quantidade,
  ADD COLUMN conteudo_unidade ENUM('kg','L','un') NULL AFTER conteudo_valor,
  ADD COLUMN conteudo_pack SMALLINT NULL AFTER conteudo_unidade;

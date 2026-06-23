-- 079 — Preço CONDICIONAL (mais baixo) + o motivo. Muitas farmácias mostram DOIS preços
-- num remédio caro: o normal (de prateleira, que todos pagam) e um mais barato CONDICIONAL
-- — tipicamente o "Desconto do laboratório" (PBM, exige CPF/cadastro, varia por quantidade).
-- Regra do dono (2026-06-23): `preco` = o NORMAL (base honesta da comparação); o condicional
-- fica à parte COM o motivo, para a busca deixar claro porque aquele preço é possível.
-- Aditiva, só app_bigbag.

ALTER TABLE catalogo_produto
  ADD COLUMN preco_cond     DECIMAL(10,2) NULL AFTER preco,   -- preço condicional mais baixo
  ADD COLUMN preco_cond_obs VARCHAR(160)  NULL AFTER preco_cond; -- o motivo (ex.: "Desconto do laboratório (PBM)")

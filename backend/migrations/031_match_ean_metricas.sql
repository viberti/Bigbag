-- Métricas para a revisão na aba "EANs": peso/preço de AMBOS os lados — o item do
-- talão (sem EAN) e o candidato do catálogo (com EAN) — para o operador comparar
-- e julgar (na mesma loja, preço≈preço e formato≈formato confirmam o match).
ALTER TABLE match_ean_sugestao
  ADD COLUMN preco_pago   DECIMAL(10,2) NULL AFTER confianca,   -- € pago no talão
  ADD COLUMN preco_cand   DECIMAL(10,2) NULL AFTER preco_pago,  -- € do catálogo (embalagem)
  ADD COLUMN formato_pago VARCHAR(40)   NULL AFTER preco_cand,  -- peso/volume lido no talão
  ADD COLUMN formato_cand VARCHAR(60)   NULL AFTER formato_pago; -- peso/volume do catálogo

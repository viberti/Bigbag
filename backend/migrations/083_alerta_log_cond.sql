-- 083 — preço CONDICIONAL (PBM) informativo no alerta_log (Trilho A, motor de gatilho). O gatilho
-- dispara SÓ sobre preço de TABELA (postura 2); estas colunas guardam o preco_cond + farmácia +
-- programa QUANDO existe, para o alerta poder informar "R$X tabela; R$Y com o programa Z" SEM
-- comparar baseline-de-tabela com condicional-com-cadastro (maçã vs laranja). Aditiva.
ALTER TABLE alerta_log
  ADD COLUMN preco_cond       DECIMAL(10,2) NULL AFTER disponivel,
  ADD COLUMN preco_cond_fonte VARCHAR(40)   NULL AFTER preco_cond,
  ADD COLUMN preco_cond_obs   VARCHAR(255)  NULL AFTER preco_cond_fonte;

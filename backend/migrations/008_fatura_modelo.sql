-- Migração 008 — registar o MODELO de IA usado em cada extração de fatura,
-- para comparar qualidade (ex.: flash vs flash-lite) com o sinal de
-- reconciliação que já temos. ADITIVA.

ALTER TABLE fatura
  ADD COLUMN modelo VARCHAR(60) NULL AFTER metodo_extracao;

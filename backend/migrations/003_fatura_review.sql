-- Migração 003 — qualidade da extração: discrepância + quarentena.
-- ADITIVA (ADD COLUMN/KEY): não perde dados.
-- Faturas cujo sinal honesto não bate (|discrepancia| >= 0,015) ficam
-- needs_review = TRUE e são EXCLUÍDAS das análises de preço até revisão.
-- extracao_json guarda o que o VLM extraiu (debug de casos-limite).

ALTER TABLE fatura
  ADD COLUMN discrepancia  DECIMAL(10,2) NULL AFTER total_reconciliado,
  ADD COLUMN needs_review  BOOLEAN NOT NULL DEFAULT FALSE AFTER discrepancia,
  ADD COLUMN extracao_json JSON NULL,
  ADD KEY idx_fatura_review (needs_review);

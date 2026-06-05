-- Migração 005 — número do documento fiscal, para deduplicação de faturas.
-- ADITIVA. O "Nro: FS ARQ214/141059" (Continente) / "No : FS ..." (Lidl) é
-- único por loja → chave natural de dedup. Index para lookup rápido.

ALTER TABLE fatura
  ADD COLUMN numero_fatura VARCHAR(60) NULL AFTER data_compra,
  ADD KEY idx_fatura_dedup (loja_id, numero_fatura);

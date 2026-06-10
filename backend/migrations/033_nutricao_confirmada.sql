-- Nutrição "por confirmar": quando a nutrição vem SÓ da leitura do rótulo por
-- VLM (sem OFF), fica isolada/marcada até confirmação — pelo operador (aba
-- Fichas) ou por fonte independente (OFF ganhar o produto → confirma sozinho).
-- 1 = confirmada (OFF/manual/operador); 0 = provisória (só VLM).
ALTER TABLE produto_ean
  ADD COLUMN nutricao_confirmada TINYINT(1) NOT NULL DEFAULT 1 AFTER nutricao;

-- Backfill: o que já existe com nutrição mas SEM OFF (veio do VLM) é provisório.
UPDATE produto_ean
   SET nutricao_confirmada = 0
 WHERE nutricao IS NOT NULL AND off_json IS NULL AND vlm_json IS NOT NULL;

-- Nutri-Score NUMÉRICO calculado por NÓS (nota 0–100), materializado na base_local para AUDITORIA:
-- com a nota gravada vê-se num SELECT os produtos iguais/similares com notas divergentes (que são
-- quase sempre erro de dados). É uma CACHE regenerável — recalculada por
-- scripts/calcular_nutriscore_base_local.mjs sempre que a nutrição muda; NUNCA editada à mão, NUNCA
-- canónica (a verdade continua a ser a função nutriScore() on-the-fly no /info).
-- Distinta da coluna `nutriscore` existente (essa é a letra A–E do Open Food Facts).
ALTER TABLE base_local
  ADD COLUMN ns_nota100 SMALLINT NULL,
  ADD COLUMN ns_grau    CHAR(1)  NULL,
  ADD COLUMN ns_pontos  SMALLINT NULL,
  ADD COLUMN ns_classe  VARCHAR(8)  NULL,
  ADD COLUMN ns_familia VARCHAR(24) NULL,
  ADD INDEX idx_ns_familia (ns_familia),
  ADD INDEX idx_ns_grau (ns_grau);

-- Migração 002 — classificar a loja por tipo de estabelecimento.
-- ADITIVA (ADD COLUMN/KEY): não perde dados. Permite filtrar o histórico de
-- preços só a supermercados, mantendo embora outras notas (farmácia, etc.).

ALTER TABLE loja
  ADD COLUMN tipo VARCHAR(30) NOT NULL DEFAULT 'outro' AFTER cadeia,
  ADD KEY idx_loja_tipo (tipo);

-- Classificar as lojas já existentes (idempotente).
UPDATE loja SET tipo = 'supermercado'
  WHERE cadeia IN ('Continente','Pingo Doce','Mercadona','Aldi','Lidl');
UPDATE loja SET tipo = 'farmacia'
  WHERE tipo = 'outro' AND (nome LIKE '%FARMACIA%' OR nome LIKE '%Farmácia%' OR nome LIKE '%farmácia%');

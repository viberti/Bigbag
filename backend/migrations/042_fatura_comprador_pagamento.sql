-- B5 (Analise_Fontes §2) — dois campos que o talão dá de graça e não capturávamos:
--   nif_comprador  → atribuição da compra ao MEMBRO do agregado (Sue/Gustavo têm
--                    NIFs distintos), sem login nenhum; null = não pediu c/ NIF.
--   forma_pagamento→ dinheiro|cartao|mbway|outro (rodapé) — completa os Gastos.
ALTER TABLE fatura
  ADD COLUMN nif_comprador VARCHAR(20) NULL AFTER numero_fatura,
  ADD COLUMN forma_pagamento VARCHAR(20) NULL AFTER nif_comprador;

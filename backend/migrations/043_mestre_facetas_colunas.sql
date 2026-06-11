-- Facetas do Produto Mestre como COLUNAS consultáveis (Taxonomia §11.6 / lacuna 4
-- "Facetas como campos"). Os valores JÁ vivem na `chave` (10 slots por '|') — isto
-- materializa-os para SQL poder agrupar/filtrar ("teor=magro", "estilo=grego")
-- sem parsing. `categoria` já era coluna; ficam os restantes 9 slots.
ALTER TABLE produto_mestre
  ADD COLUMN apresentacao  VARCHAR(60) NULL AFTER categoria,
  ADD COLUMN corte         VARCHAR(60) NULL AFTER apresentacao,
  ADD COLUMN processamento VARCHAR(60) NULL AFTER corte,
  ADD COLUMN variedade     VARCHAR(60) NULL AFTER processamento,
  ADD COLUMN sabor         VARCHAR(60) NULL AFTER variedade,
  ADD COLUMN teor          VARCHAR(60) NULL AFTER sabor,
  ADD COLUMN estilo        VARCHAR(60) NULL AFTER teor,
  ADD COLUMN funcao        VARCHAR(60) NULL AFTER estilo,
  ADD COLUMN fonte         VARCHAR(60) NULL AFTER funcao;

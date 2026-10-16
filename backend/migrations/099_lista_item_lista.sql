-- 099: várias LISTAS de compras na mesma casa (2026-10-16).
-- A app "Lista" (/lista, simples, só lista de compras) tem a SUA lista, separada da do
-- BigBag (decisão do dono). Aditiva: as linhas existentes ficam na lista 'bigbag'
-- (default), por isso o BigBag continua igual. Valores válidos vivem em src/listaId.js.
ALTER TABLE lista_item
  ADD COLUMN lista VARCHAR(16) NOT NULL DEFAULT 'bigbag' AFTER id,
  ADD INDEX idx_lista_item_lista_estado (lista, estado);

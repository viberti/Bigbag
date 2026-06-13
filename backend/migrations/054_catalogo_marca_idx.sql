-- Índice em catalogo_produto.marca — a lista/despensa fazem `WHERE marca = ?`
-- (aplicarPrecoPorIrmao, por item órfão) e `WHERE marca IN (...)`
-- (aplicarTamanhoPorNome). Sem índice eram full-scans de ~62k linhas (~540ms
-- CADA), o grosso dos 6-7s a carregar a despensa. Aditivo, não-destrutivo.
CREATE INDEX idx_marca ON catalogo_produto (marca);

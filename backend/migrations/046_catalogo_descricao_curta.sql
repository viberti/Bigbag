-- 046 — Abreviatura de TALÃO no catálogo (descoberta 2026-06-11).
--
-- O JSON-LD das páginas do Pingo Doce traz em `description` a ABREVIATURA OFICIAL
-- DE TALÃO do produto ("IOG MAG PD NAT 125G", "ÁGUA VITALIS 6X1,5L", "TOMATE
-- COMPAL 500G") — exatamente o que sai impresso nos talões PD. Vale ouro a dobrar:
--   1. traz o TAMANHO que falta ao catálogo PD (os nomes não o têm);
--   2. permite matching talão↔catálogo VERBATIM para compras Pingo Doce
--      (a cadeia com pior cobertura de identidade: 112 descrições, 2 com EAN).
-- ALTER aditivo sobre app_bigbag.
ALTER TABLE catalogo_produto
  ADD COLUMN descricao_curta VARCHAR(80) NULL AFTER marca;

-- Flag: item de produto vendido a PESO/VOLUME (unidade kg/L) mas SEM peso/volume
-- na nota → preco_por_base fica NULL (incomputável honesto) e este flag marca o
-- PORQUÊ, para excluir das comparações €/kg sem fingir um valor enganador.
-- Caso típico: "MAMÃO PARTIDO" — peça cortada vendida por preço fixo, sem kg
-- impresso (o talão do Mercadona mostra banana/batata com kg, mas o mamão não).
ALTER TABLE item ADD COLUMN peso_em_falta TINYINT(1) NOT NULL DEFAULT 0 AFTER preco_por_base;

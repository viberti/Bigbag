-- Cache de nutrição POR CATEGORIA (a nutrição pendura-se na classe, não no item).
-- Busca-uma-vez ao Open Food Facts (mediana + dispersão da categoria) e guarda;
-- reusa-se para sempre. A dispersão (concentração do Nutri-Score modal) é o sinal
-- de CONFIANÇA: estreita → estimativa fiável; larga → vale um scan (EAN). Ver
-- docs/Visao_Conselheiro_Saude_Alimentar.md.
CREATE TABLE IF NOT EXISTS categoria_nutricao (
  categoria      VARCHAR(120) PRIMARY KEY,          -- categoria do Mestre (ex.: 'queijo')
  off_tag        VARCHAR(80),                       -- tag OFF (ex.: 'cheeses'); NULL p/ whole/meat
  origem         VARCHAR(12) NOT NULL,              -- 'off' | 'whole' | 'meat' | 'manual'
  n_amostra      INT,                               -- nº de produtos OFF na amostra
  nutriscore     CHAR(1),                           -- modal A..E (ou NULL)
  nova_group     TINYINT,                           -- modal 1..4 (ou NULL)
  acucar_med     DECIMAL(6,2),                      -- mediana açúcar/100g
  gord_sat_med   DECIMAL(6,2),                      -- mediana gordura saturada/100g
  sal_med        DECIMAL(6,3),                      -- mediana sal/100g
  dispersao      VARCHAR(10),                       -- 'estreita' | 'larga' (confiança)
  atualizado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

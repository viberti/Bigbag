-- 063 — ean_empresa: prefixo GS1 de empresa → marca dominante + país + COERÊNCIA medida
-- (Classificacao_Fusor §5.4). Minado dos nossos (ean,marca). O `share` é a pureza do
-- prefixo = peso do voto: alto → empresa-especialista (rotear com confiança); baixo →
-- prefixo partilhado/generalista (não asserir marca). Reconstruível (DELETE+INSERT). Aditiva.
CREATE TABLE IF NOT EXISTS ean_empresa (
  prefixo     VARCHAR(10) NOT NULL PRIMARY KEY,  -- N primeiros dígitos do EAN (empresa)
  marca       VARCHAR(140),                      -- marca dominante nesse prefixo
  pais        CHAR(2),                            -- país GS1 do prefixo (paisDoEan)
  n_produtos  INT NOT NULL,                       -- nº de EANs nossos com este prefixo
  share       DECIMAL(4,3) NOT NULL,              -- pureza (coerência) = share da marca dominante
  atualizado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

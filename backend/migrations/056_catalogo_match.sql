-- Elos CROSS-LOJA por imagem+metadados: liga um produto de catálogo SEM EAN
-- (Pingo Doce, Lidl) ao mesmo produto no catálogo COM EAN (Continente/Auchan/
-- Mercadona). NÃO sobrescreve nada — é a camada de sugestões/proveniência. 1 linha
-- por produto-origem (uq_origem) → o lote é reentrante. Distinta de
-- match_ean_sugestao (esse liga DESCRIÇÕES de talão, com preço pago).
CREATE TABLE IF NOT EXISTS catalogo_match (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  origem_id    BIGINT UNSIGNED NOT NULL,           -- catalogo_produto.id SEM ean (a foto-pergunta)
  origem_fonte VARCHAR(40)  NULL,                  -- 'pingodoce' / 'lidl'
  ean          VARCHAR(20)  NULL,                  -- EAN do produto casado (NULL se sem match)
  cand_id      BIGINT UNSIGNED NULL,               -- catalogo_produto.id COM ean que casou
  cand_fonte   VARCHAR(40)  NULL,                  -- continente / auchan / mercadona
  score        DECIMAL(4,3) NULL,                  -- cosseno visual
  marca_estado VARCHAR(10)  NULL,                  -- igual / conflito / desc
  peso_estado  VARCHAR(10)  NULL,                  -- igual / difere / desc
  nome_ov      DECIMAL(4,3) NULL,                  -- overlap de nome distintivo
  banda        VARCHAR(16)  NOT NULL,              -- auto / outro_tamanho / revisao / rejeitado / sem_match / sem_imagem
  estado       VARCHAR(12)  NOT NULL DEFAULT 'pendente', -- pendente / aprovado / rejeitado
  criado_em    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decidido_em  TIMESTAMP NULL,
  UNIQUE KEY uq_origem (origem_id),
  KEY idx_ean (ean),
  KEY idx_banda (banda),
  KEY idx_estado (estado)
);

-- Propostas de EAN por matching (nome do talão → catálogo Auchan/Continente),
-- para o operador rever na aba "EANs" do /admin (aprovar/rejeitar/corrigir). Uma
-- por descrição de produto. Ao APROVAR, o item ganha o EAN + ficha (via mestrePorEan,
-- que enriquece a nutrição pelo Open Food Facts).
CREATE TABLE IF NOT EXISTS match_ean_sugestao (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  descricao    VARCHAR(200) NOT NULL,                 -- descricao_original (chave do produto)
  ean          VARCHAR(20)  NOT NULL,                 -- EAN proposto (candidato vencedor)
  nome_cand    VARCHAR(255),                          -- nome do candidato no catálogo
  marca        VARCHAR(140),
  fonte        VARCHAR(40),                           -- auchan / continente / auchan+continente …
  confianca    DECIMAL(4,3),                          -- pontuação do match (0..1)
  alternativas TEXT,                                  -- outras hipóteses: "EAN|nome|score" separadas por '||'
  estado       VARCHAR(12) NOT NULL DEFAULT 'pendente', -- pendente | aprovado | rejeitado
  criado_em    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decidido_em  TIMESTAMP NULL,
  UNIQUE KEY uq_descricao (descricao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

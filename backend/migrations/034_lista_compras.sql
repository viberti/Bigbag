-- Lista de compras PARTILHADA da família (substitui o carrinho local por
-- aparelho): todos os membros veem/alteram a MESMA lista; sincroniza por
-- polling curto. Estados: 'ativo' (na lista) · 'carrinho' (riscado — recolhido
-- na loja, fica visível) · 'comprado' (saiu via reconciliação com o talão) ·
-- 'removido' (swipe/limpar). Histórico preservado (soft delete).
CREATE TABLE IF NOT EXISTS lista_item (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome           VARCHAR(160) NOT NULL,
  quantidade     INT NOT NULL DEFAULT 1,
  categoria      VARCHAR(80) NULL,            -- secção do mercado (dos habituais, quando o nome bate)
  estado         VARCHAR(12) NOT NULL DEFAULT 'ativo',
  adicionado_por VARCHAR(64) NOT NULL,        -- membro que adicionou (ícone na UI)
  marcado_por    VARCHAR(64) NULL,            -- membro que riscou (cor do risco)
  fatura_id      BIGINT UNSIGNED NULL,        -- reconciliação: talão que comprou o item
  criado_em      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_estado (estado, atualizado_em)
);

-- Lista INDIVIDUAL de cada membro (ex.: itens que só a Sue consome) — fonte
-- rápida para adicionar à lista da casa com um toque ("+").
CREATE TABLE IF NOT EXISTS lista_pessoal (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  utilizador VARCHAR(64) NOT NULL,
  nome       VARCHAR(160) NOT NULL,
  criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_nome (utilizador, nome)
);

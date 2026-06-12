-- 049 — DESPENSA = inventário do que a casa TEM (alimentado por SCAN), não o que
-- comprou. A despensa antiga derivava das compras (produto_ean com item_id) — o
-- dono decidiu (2026-06-12) que isso não é útil: a despensa real é o que se lê com
-- o leitor de código de barras enquanto se faz a lista ("scaneei o que tenho em
-- casa"). Partilhada pela família, como a lista (uma linha por EAN; re-scan
-- atualiza). Não-destrutivo: cria tabela nova; a query antiga deixa de se usar.
CREATE TABLE IF NOT EXISTS despensa (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ean           VARCHAR(20) NOT NULL,
  nome          VARCHAR(200) NULL,           -- nome PT no momento do scan (snapshot)
  marca         VARCHAR(120) NULL,
  validade      VARCHAR(60)  NULL,           -- se a ficha do EAN a conhecer
  utilizador    VARCHAR(64)  NULL,           -- membro que scaneou
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ean (ean),
  INDEX idx_atualizado (atualizado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

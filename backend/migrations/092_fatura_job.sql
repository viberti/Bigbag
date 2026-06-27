-- 092: fila de interpretação ASSÍNCRONA de talões (dono, 2026-06-27).
-- A foto entra, o servidor responde JÁ com um job 'em_analise' e não prende o
-- utilizador; um worker em fundo corre o pipeline (extrair VLM → reconciliar →
-- persistir → normalizar) e liga o job à fatura real. Estados que o job atravessa:
--   em_analise → pronto  (lido e reconciliado)
--             → precisa_revisao  (lido, mas o total não fechou)
--             → falhou  (imagem não-talão / erro após retentativas)
-- Tolerância a falhas: lease_em + tentativas — um job preso (reinício do worker)
-- é re-apanhado pela varredura; falha definitiva fica 'falhou' com a opção de repetir.
CREATE TABLE IF NOT EXISTS fatura_job (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id VARCHAR(190) NULL,                 -- email do utilizador (cartões por pessoa)
  ficheiro_original VARCHAR(255) NOT NULL,      -- imagem/PDF já guardado no disco
  mime VARCHAR(80) NULL,
  metodo VARCHAR(16) NOT NULL DEFAULT 'vlm',
  origem_captura VARCHAR(16) NULL,
  estado ENUM('em_analise','pronto','precisa_revisao','falhou') NOT NULL DEFAULT 'em_analise',
  fatura_id INT NULL,                           -- preenchido quando lido (link à fatura real)
  duplicada TINYINT NOT NULL DEFAULT 0,
  n_itens INT NULL,
  loja_nome VARCHAR(120) NULL,                  -- resumo p/ o cartão "em análise"→"lido"
  total DECIMAL(10,2) NULL,
  data_compra DATE NULL,
  erro VARCHAR(255) NULL,
  tentativas INT NOT NULL DEFAULT 0,
  lease_em DATETIME NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_estado_lease (estado, lease_em),
  KEY idx_user (usuario_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

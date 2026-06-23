-- 082 — Trilho A: monitor de preço de canetas GLP-1 POR USUÁRIO (MVP). SÓ SCHEMA (o motor de
-- gatilho e o push/FCM são tarefas seguintes, separadas). Dado de saúde = SENSÍVEL → a lista/baseline/
-- alertas vivem sempre atrás de auth (req.user.id = email). Reutiliza: `usuario` (âncora email), o
-- padrão `lista_pessoal` (coluna `utilizador`), o monitor denso `medicamento_monitor_hist` (o gatilho
-- lerá daqui), o `/catalogo` (mediana). Aditiva, idempotente, só app_bigbag.
--
-- LGPD (dado de saúde): a coluna `utilizador` é a ÚNICA PII e tem FK → usuario(email) ON DELETE CASCADE
-- nas 2 tabelas → a exclusão GENUÍNA da conta é trivial e completa (DELETE FROM usuario apaga em
-- cascata monitores+alertas, sem PII órfã). O fluxo de exclusão-total NÃO se implementa aqui — o
-- schema só o habilita. Operação normal de remover monitor = soft-delete (ativo=0).
--
-- PONTE (tarefa do MOTOR, não aqui): o job de coleta densa ganhará `... OR m.ean IN (SELECT ean FROM
-- usuario_monitor WHERE ativo=1)` → o EAN exato do usuário entra no conjunto 4/4h. NOTA DE CAPACIDADE:
-- isso faz o conjunto crescer com a base; inócuo no MVP (semaglutida/tirzepatida já cobertas),
-- revisitar quando muitos usuários monitorarem muitas moléculas.

-- Monitor por (usuário × APRESENTAÇÃO/EAN). Gatilho dispara com limiar E piso SIMULTÂNEOS.
CREATE TABLE IF NOT EXISTS usuario_monitor (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  utilizador         VARCHAR(160)  NOT NULL,                 -- = req.user.id (email); convenção lista_pessoal
  ean                VARCHAR(14)   NOT NULL,                 -- apresentação monitorada (não marca)
  baseline_declarado DECIMAL(10,2) NOT NULL,                 -- baseline EFETIVO (o gatilho compara com este)
  baseline_sugerido  DECIMAL(10,2) NULL,                     -- mediana de mercado na criação (referência)
  baseline_origem    ENUM('declarado','aceito_sugerido') NOT NULL,
  limiar_pct         DECIMAL(5,2)  NOT NULL DEFAULT 8.00,    -- queda relativa (%) vs baseline
  piso_abs           DECIMAL(10,2) NOT NULL DEFAULT 80.00,   -- piso absoluto (R$) — exigido JUNTO com o limiar
  exige_estoque      TINYINT       NOT NULL DEFAULT 1,       -- trava de estoque (só dispara se disponível)
  cooldown_horas     INT           NOT NULL DEFAULT 72,      -- silêncio entre alertas do mesmo monitor
  ultimo_alerta_em   DATETIME      NULL,                     -- p/ o cooldown
  ativo              TINYINT       NOT NULL DEFAULT 1,        -- soft-delete (exclusão real via FK CASCADE)
  criado_em          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_ean (utilizador, ean),                 -- 1 monitor por (usuário, apresentação)
  KEY idx_ativo_ean (ativo, ean),                           -- p/ a ponte do monitor denso
  CONSTRAINT fk_monitor_usuario FOREIGN KEY (utilizador) REFERENCES usuario (email) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Histórico de alertas disparados (cooldown + medir qualidade depois).
CREATE TABLE IF NOT EXISTS alerta_log (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  monitor_id          BIGINT UNSIGNED NULL,                  -- qual config disparou
  utilizador          VARCHAR(160)  NOT NULL,                -- mesmo nome/tipo da tabela 1
  ean                 VARCHAR(14)   NOT NULL,
  preco_gatilho       DECIMAL(10,2) NOT NULL,                -- preço que disparou
  baseline_no_momento DECIMAL(10,2) NOT NULL,                -- baseline efetivo NO disparo (não o atual)
  desconto_pct        DECIMAL(5,2)  NULL,                    -- % abaixo do baseline
  fonte               VARCHAR(40)   NOT NULL,                -- farmácia mais barata no disparo
  disponivel          TINYINT       NULL,                    -- estoque no momento
  entregue            TINYINT       NOT NULL DEFAULT 0,       -- estado de entrega (push é tarefa futura)
  disparado_em        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_ts (utilizador, disparado_em),
  KEY idx_cooldown (monitor_id, disparado_em),
  KEY idx_ean_ts (ean, disparado_em),
  CONSTRAINT fk_alerta_usuario FOREIGN KEY (utilizador) REFERENCES usuario (email) ON DELETE CASCADE,
  CONSTRAINT fk_alerta_monitor FOREIGN KEY (monitor_id) REFERENCES usuario_monitor (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

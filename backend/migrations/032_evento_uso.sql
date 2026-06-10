-- Telemetria de USO (self-hosted, sem terceiros): que funcionalidades são usadas,
-- quantas vezes, por quem e quando. Eventos, não píxeis. NUNCA conteúdo (só QUAL
-- ação, não o que foi escrito/comprado). `fonte` = 'api' (middleware regista o
-- PADRÃO da rota, ex.: GET /api/produto/despensa) ou 'ui' (ações só-frontend, ex.:
-- vista_categoria). `sessao` = id aleatório por carregamento da app (liga ações da
-- mesma visita, sem fingerprint). `props` = metadados mínimos (ex.: {vista:"categoria"}).
CREATE TABLE IF NOT EXISTS evento_uso (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fonte       VARCHAR(8)   NOT NULL DEFAULT 'ui',   -- 'api' | 'ui'
  utilizador  VARCHAR(64)  NULL,
  sessao      VARCHAR(40)  NULL,
  evento      VARCHAR(120) NOT NULL,
  props       JSON         NULL,
  criado_em   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_evento (evento, criado_em),
  INDEX idx_fonte  (fonte, criado_em),
  INDEX idx_user   (utilizador, criado_em)
);

-- Perfil nutricional por membro do agregado (carregado de um ficheiro gerado por
-- LLM a partir dos exames/objetivos/cardápio). Guarda o texto bruto (nuance) + um
-- resumo estruturado (para alertas determinísticos). Um perfil "ativo" de cada vez.
CREATE TABLE IF NOT EXISTS perfil_membro (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nome          VARCHAR(80) NOT NULL,
  texto         MEDIUMTEXT,        -- perfil em texto (bruto)
  resumo        JSON,              -- { objetivos, restricoes, alergias, intolerancias, condicoes, preferir, evitar, nutrientes, notas }
  ativo         TINYINT DEFAULT 0, -- 1 = perfil usado nas avaliações personalizadas
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

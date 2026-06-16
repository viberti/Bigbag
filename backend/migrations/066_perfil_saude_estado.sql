-- 066: estado do EDITOR de perfil de saúde (handoff cartoon v13).
-- O `resumo` (JSON) fica PURO — só as características ATIVAS (objetivos/condicoes/restricoes/
-- preferir/evitar/metas), que a avaliação personalizada já lê (avaliarParaPerfil serializa o
-- resumo inteiro no prompt). As características DESATIVADAS (guardadas mas não avaliadas) e a
-- demografia do membro (email/idade/sexo/peso/altura) vivem à parte, para não poluir o prompt.
ALTER TABLE perfil_membro ADD COLUMN saude_estado JSON NULL;

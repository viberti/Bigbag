-- 080 — Preço CONDICIONAL no histórico do monitor 4/4h. Os remédios monitorados (Ozempic,
-- Mounjaro) e a sua classe (semaglutida/tirzepatida — equivalentes+genéricos) merecem atenção
-- especial (dono, 2026-06-23): além do preço normal + estoque, guardar também o "Desconto do
-- laboratório" (PBM) onde é público (Panvel, Araújo) → série temporal dos DOIS preços.
-- Aditiva, só app_bigbag.

ALTER TABLE medicamento_monitor_hist
  ADD COLUMN preco_cond DECIMAL(10,2) NULL AFTER preco;   -- preço condicional (PBM), quando publicado

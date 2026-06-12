-- 052 — Metadados da FUSÃO de fontes da ficha por EAN (resolvedor único,
-- desenho fechado com o dono 2026-06-13). JSON com: proveniencia (campo→fonte),
-- divergencias (fontes que discordaram do escolhido — só registo, sem worklist),
-- fontes_hash (re-funde só quando uma fonte muda) e fundido_em.
-- Campo com proveniencia 'manual' NUNCA é sobrescrito pela re-fusão.
-- Não-destrutivo: coluna nova, opcional.
ALTER TABLE produto_ean ADD COLUMN fusao JSON NULL;

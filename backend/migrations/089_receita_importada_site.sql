-- 089 — nome amigável do site de origem (og:site_name, ex.: "Panelinha") além do domínio (fonte).
ALTER TABLE receita_importada ADD COLUMN site_nome VARCHAR(120) NULL AFTER fonte;

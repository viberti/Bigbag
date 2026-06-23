-- 081 — override CURADO de força clínica + quantidade (Cluster 2). ADITIVO: a equivalência lê
-- COALESCE(medicamento_curado, medicamento); o import semanal da CMED NUNCA toca aqui (sobrevive
-- ao reload). dose_valor da CMED é a CONCENTRAÇÃO (mg/ml); aqui guardamos a FORÇA CLÍNICA real
-- (curada do texto oficial `apresentacao` + cross-check da lupa). Só app_bigbag.
--   forca_valor_max NÃO-NULO = FAIXA (caneta de titulação dual, ex. 0,25/0,5) → isola na equivalência.
--   papel = rótulo legível ('manutencao' | 'inicio'); a trava estrutural é forca_valor_max.

CREATE TABLE IF NOT EXISTS medicamento_curado (
  ean                 varchar(14)   NOT NULL,
  registro            varchar(20)   DEFAULT NULL,           -- âncora oficial ANVISA (rastreabilidade)
  forca_valor         decimal(10,4) DEFAULT NULL,           -- força CLÍNICA (não a concentração)
  forca_valor_max     decimal(12,4) DEFAULT NULL,           -- faixa (caneta dual 0,25/0,5); NULL = força exata
  forca_unidade       varchar(16)   DEFAULT NULL,           -- 'mg'
  forca_periodicidade varchar(16)   DEFAULT NULL,           -- 'semana' (GLP-1 semanal); NULL se n/a
  papel               varchar(20)   DEFAULT NULL,           -- 'manutencao' | 'inicio'
  qtd_embalagem_corr  int           DEFAULT NULL,           -- override de qtd quando a oficial é 0/errada
  fonte_curadoria     varchar(120)  DEFAULT NULL,
  curado_em           datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  curado_por          varchar(80)   DEFAULT NULL,
  nota                varchar(255)  DEFAULT NULL,
  PRIMARY KEY (ean),
  KEY idx_curado_equiv (forca_valor, forca_valor_max, papel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

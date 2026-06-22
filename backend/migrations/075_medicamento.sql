-- 075 — Módulo de medicamentos (Brasil). IDENTIDADE universal por EAN, alimentada
-- pela lista CMED/ANVISA (Câmara de Regulação do Mercado de Medicamentos): a fonte
-- pública e autoritativa de TODO medicamento registado no Brasil — substância
-- (princípio ativo), apresentação, laboratório, tipo (referência/genérico/similar)
-- e os PREÇOS-TETO legais PF (preço fábrica) e PMC (preço máximo ao consumidor) por
-- alíquota de ICMS. É o "registo-jackpot" dos remédios (equivalente ao Cosmos/Bluesoft).
--
-- O PREÇO praticado (por farmácia) NÃO vive aqui: reutiliza o pipeline endurecido
-- catalogo_produto (UPSERT) + catalogo_preco_hist (histórico). A "vista de
-- medicamento" = catalogo_produto ⋈ medicamento on ean. Esta tabela é a camada de
-- IDENTIDADE; o PMC é só referência/teto legal para comparar o preço praticado.
--
-- Aditiva, só app_bigbag. Uma linha POR EAN (a CMED traz até 3 EANs por registo →
-- expandem-se; partilham a mesma identidade). Carga: scripts/carregar_cmed.mjs.

CREATE TABLE IF NOT EXISTS medicamento (
  ean                 VARCHAR(14)  NOT NULL,            -- chave canónica (como em todo o BigBag)
  registro            VARCHAR(20)  NULL,                -- registo ANVISA
  ggrem               VARCHAR(20)  NULL,                -- código GGREM (identificador CMED)
  substancia          VARCHAR(300) NULL,                -- princípio ativo — CHAVE da comparação por equivalência
  produto             VARCHAR(300) NULL,                -- nome comercial
  apresentacao        VARCHAR(600) NULL,                -- "500 MG COM REV CT BL AL PLAS INC X 30"
  laboratorio         VARCHAR(255) NULL,
  classe_terapeutica  VARCHAR(255) NULL,
  tipo                VARCHAR(40)  NULL,                -- "Genérico" | "Similar" | "Novo" | "Específico" | "Biológico" | "Fitoterápico" | ...
  generico            TINYINT(1)   NOT NULL DEFAULT 0, -- atalho derivado de tipo='Genérico'
  tarja               VARCHAR(80)  NULL,                -- tarja/venda (enriquecido depois; CMED nem sempre traz)

  -- apresentação parseada (normaliza/medicamento.js) → comparação por dose
  dosagem             VARCHAR(80)  NULL,                -- "500 MG", "10 MG/ML"
  dose_valor          DECIMAL(12,4) NULL,              -- 500 (valor numérico p/ ordenar/comparar)
  dose_unidade        VARCHAR(16)  NULL,                -- "MG", "ML", "G", "MG/ML"
  forma               VARCHAR(60)  NULL,                -- "comprimido" | "cápsula" | "solução" | "xarope" | ...
  qtd_embalagem       INT          NULL,               -- 30 (comprimidos/cápsulas/ml na embalagem)

  -- preços-teto CMED (R$). pf = Preço Fábrica sem impostos; pmc_18 = PMC a 18% ICMS
  -- (alíquota mais comum, ex. SP/MG/RJ ~18-20%) usado como referência rápida; o mapa
  -- completo por alíquota fica em pmc_por_icms (JSON) p/ escolher pela UF do usuário.
  pf                  DECIMAL(10,2) NULL,              -- PF sem impostos
  pmc_18              DECIMAL(10,2) NULL,              -- PMC 18% ICMS (referência)
  pmc_por_icms        JSON          NULL,              -- {"0":.., "12":.., "17":.., "18":.., "20":.., ...}
  pf_por_icms         JSON          NULL,

  restricao_hospitalar TINYINT(1)  NOT NULL DEFAULT 0, -- uso restrito a hospitais
  comercializado      TINYINT(1)   NOT NULL DEFAULT 1, -- "Comercialização" = Sim na CMED
  cmed_versao         DATE          NULL,              -- data da lista CMED carregada
  raw                 JSON          NULL,              -- linha CMED crua (auditoria)
  criado_em           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (ean),
  KEY idx_med_substancia (substancia),
  KEY idx_med_equiv (substancia, dose_valor, forma),  -- agrupar equivalentes (genérico vs referência)
  KEY idx_med_registro (registro),
  KEY idx_med_produto (produto),
  FULLTEXT KEY ft_med (produto, substancia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

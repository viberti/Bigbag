# Schema da BD + Funções de Tool Use — para implementação

> Entrada para o Claude Code. Define a estrutura de dados e o contrato das funções de consulta. Decisões de design explicadas em comentário; a implementação (migrações, ORM/queries, validação) é do Claude Code.
>
> Premissas: MySQL 8 (`app_<PROJ>`), utilizador único (sem `user_id`), charset `utf8mb4`.

---

## 1. Schema MySQL

```sql
-- ─────────────────────────────────────────────────────────────
-- LOJA: cada estabelecimento físico. Cadeia + localização em Braga.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE loja (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  cadeia        VARCHAR(40)  NOT NULL,           -- 'Continente','Pingo Doce','Mercadona','Aldi','Lidl'
  tipo          VARCHAR(30)  NOT NULL DEFAULT 'outro', -- 'supermercado','farmacia','outro' (migração 002)
  nome          VARCHAR(120) NOT NULL,           -- nome impresso na fatura
  nif           VARCHAR(20),                     -- NIF do estabelecimento (chave natural útil)
  localizacao   VARCHAR(160),                    -- morada/zona em Braga
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loja_nif (nif),
  KEY idx_loja_cadeia (cadeia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- SKU_NORMALIZADO: o produto canónico. É o que liga o MESMO produto
-- escrito de formas diferentes entre lojas/datas. Coração da comparação.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE sku_normalizado (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nome_canonico VARCHAR(160) NOT NULL,           -- 'Bolacha Digestive de Aveia'
  marca         VARCHAR(80),                     -- 'Continente', 'Mimosa', null se desconhecida
  -- proveniência da marca (migração 036): marcador (CNT/PD/ARO no talão) |
  -- gazetteer (marca impressa, dicionário do catálogo) | catalogo | ean | prior |
  -- llm (palpite) | manual. NULL = pré-036. Marca lida ≠ marca adivinhada.
  marca_origem  VARCHAR(12),
  categoria     VARCHAR(80),                     -- 'Mercearia Doce', 'Laticínios'... (texto livre, detalhe)
  -- GRUPO de alto nível, vocabulário FECHADO (migração 041, B1): 11 valores
  -- (frutas|carne|peixe|lacticinios|padaria|bebidas|doces|congelados|higiene|
  -- mercearia|outros), determinístico (food_groups do OFF → categoria → nome,
  -- normaliza/categoria.js). É o eixo estável para agrupar/filtrar; a `categoria`
  -- texto-livre fica como detalhe. mestre_id liga ao Produto Mestre facetado (§1d).
  grupo         VARCHAR(16),
  mestre_id     BIGINT UNSIGNED,                 -- → produto_mestre (agrupar p/ comparar marcas)
  -- unidade-base para comparação de preço (ver nota de design sobre quantidades).
  -- DECIDIDA determinística-primeiro: se a descrição traz peso/volume EXPLÍCITO
  -- (g/kg/ml/cl/L, incl. multipack "4X125G"=500g), o formato GANHA ao LLM
  -- (corrige fruta/legumes/queijo a peso que o LLM punha como 'un'); exceção:
  -- categorias contadas (ovos, sabonete) ficam 'un'. Ver decidirUnidadeBase().
  unidade_base  ENUM('un','kg','L') NOT NULL DEFAULT 'un',
  formato_valor DECIMAL(10,3),                   -- 0.425 (kg), 1.000 (L), 1 (un)
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sku_nome (nome_canonico),
  KEY idx_sku_categoria (categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- SKU_ALIAS: cache descrição-de-talão → SKU. A 1ª vez que uma descrição
-- aparece é resolvida (LLM/match); a partir daí o alias evita nova chamada.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE sku_alias (
  descricao_original VARCHAR(200) PRIMARY KEY,      -- chave única → determina o resto
  sku_id             BIGINT UNSIGNED NOT NULL,
  origem             ENUM('llm','manual') NOT NULL, -- manual = associação/fusão do operador
  confianca          TINYINT NULL                   -- 0–100 do mapeamento, por via (migração 016):
  --   100 manual/fusão · 90 match · 75 match-llm (juiz) · 60 SKU novo · NULL legado
);

-- ─────────────────────────────────────────────────────────────
-- FATURA: uma compra. Guarda total impresso E reconciliado para
-- validar a extração (Σ itens − desconto_global deve bater com o total).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE fatura (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  loja_id             BIGINT UNSIGNED NOT NULL,
  data_compra         DATETIME NOT NULL,
  numero_fatura       VARCHAR(60),               -- nº do documento fiscal (ATCUD/FS/Nº) p/ dedup
  nif_comprador       VARCHAR(20),               -- NIF do CLIENTE quando impresso (migração 042) → atribuir compra ao membro do agregado; dígitos
  forma_pagamento     VARCHAR(20),               -- dinheiro|cartao|mbway|outro (migração 042) — completa os Gastos
  total_impresso      DECIMAL(10,2) NOT NULL,    -- o que vinha escrito na fatura
  total_reconciliado  DECIMAL(10,2),             -- Σbase − desconto_global (calculado); deve ≈ total_impresso
  discrepancia        DECIMAL(10,2),             -- Σbase − desconto − total; 0 = extração bate (migração 003)
  needs_review        BOOLEAN DEFAULT FALSE,     -- TRUE se não bate; EXCLUÍDA das análises de preço (migração 003)
  extracao_json       JSON,                      -- snapshot do que o VLM extraiu, p/ debug (migração 003)
  desconto_global     DECIMAL(10,2) DEFAULT 0,   -- ex. Desconto Cartão Continente; desconto DA NOTA, NÃO espalhado pelos itens
  precos_com_iva      TINYINT(1) DEFAULT 1,      -- 1=preços das linhas JÁ com IVA (supermercado); 0=sem IVA (grossista/Makro) — migração 015
  ficheiro_original   VARCHAR(255),              -- caminho em /var/lib/<PROJ>/comprovantes
  metodo_extracao     ENUM('vlm','ocr_llm') ,    -- qual abordagem gerou estes dados (para a comparação)
  origem_captura      VARCHAR(16),               -- 'scan'|'foto'|'galeria'|'arquivo' — caminho de captura (migração 010)
  criado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fatura_loja FOREIGN KEY (loja_id) REFERENCES loja(id),
  KEY idx_fatura_data (data_compra)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ITEM: cada linha da fatura. Guarda descrição original (para debug
-- da extração) E a ligação ao SKU canónico. Preço por unidade-base
-- é o que torna a comparação entre lojas correta.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE item (
  id                   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  fatura_id            BIGINT UNSIGNED NOT NULL,
  sku_id               BIGINT UNSIGNED,           -- null até ser normalizado
  descricao_original   VARCHAR(200) NOT NULL,     -- NOME limpo (qtd/peso/preço/IVA vão fora) — 'BOL DIGESTIVE AVEIA CNT 425GR'
  ean                  VARCHAR(20),               -- EAN-13 impresso NA LINHA do talão (cash-and-carry/Makro: "Nº Código Artigo"); validado pelo dígito verificador antes de gravar → autoritativo sobre o lido à mão; migração 027
  linha_peso           VARCHAR(80),               -- peso de balcão à parte do nome ('2,426 kg x 1,20 EUR/kg') — fonte do €/kg; migração 013
  quantidade           DECIMAL(10,3) NOT NULL DEFAULT 1,  -- 3 (un) ou 0.418 (kg)
  preco_unitario       DECIMAL(10,4),             -- preço por unidade tal como na fatura
  preco_liquido        DECIMAL(10,2) NOT NULL,    -- preço IMPRESSO na linha (líquido do desconto da própria linha); o desconto de cartão NÃO entra aqui
  preco_por_base       DECIMAL(10,4),             -- preço normalizado p/ unidade_base do SKU (€/kg, €/L, €/un); SEMPRE com IVA (grossista convertido × (1+taxa))
  peso_em_falta        TINYINT(1) NOT NULL DEFAULT 0, -- produto a peso (kg/L) sem peso na nota → ppb=NULL honesto, marcado p/ sair do €/kg; migração 018
  ppb_inferido         TINYINT(1) DEFAULT 0,      -- preco_por_base auto-corrigido por inferência (outlier de pack); recompute não o sobrescreve — migração 014
  taxa_iva             DECIMAL(4,3),              -- taxa de IVA do produto (0.060/0.130/0.230), resolvida na extração pelo código+legenda — migração 015
  is_clearance         BOOLEAN DEFAULT FALSE,     -- fim de validade: isolar da série histórica
  desconto_direto      DECIMAL(10,2) DEFAULT 0,   -- 'Poupança' na linha
  is_non_product       BOOLEAN DEFAULT FALSE,     -- saco, taxa: fora do histórico de preços
  CONSTRAINT fk_item_fatura FOREIGN KEY (fatura_id) REFERENCES fatura(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sku FOREIGN KEY (sku_id) REFERENCES sku_normalizado(id),
  KEY idx_item_sku (sku_id),
  KEY idx_item_fatura (fatura_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 1b. Conselheiro de saúde alimentar — identificação de produto + nutrição (migrações 019–026)

Bloco para o Bigbag conhecer o **produto** (não só o preço): identificar por EAN/fotos, herdar nutrição (Open Food Facts ou tabela de composição para frescos), analisar de forma factual e avaliar à luz do perfil de cada membro. Ver `docs/Visao_Conselheiro_Saude_Alimentar.md`.

```sql
-- ─────────────────────────────────────────────────────────────
-- CATEGORIA_NUTRICAO (migração 019): cache de nutrição POR CATEGORIA — a
-- nutrição pendura-se na CLASSE, não no item. Busca-uma-vez ao OFF (mediana +
-- dispersão da categoria) e reusa. A dispersão é o sinal de CONFIANÇA:
-- estreita → estimativa fiável; larga → vale um scan (EAN).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE categoria_nutricao (
  categoria      VARCHAR(120) PRIMARY KEY,        -- categoria do Mestre (ex.: 'queijo')
  off_tag        VARCHAR(80),                     -- tag OFF (ex.: 'cheeses'); NULL p/ whole/meat
  origem         VARCHAR(12) NOT NULL,            -- 'off' | 'whole' | 'meat' | 'manual'
  n_amostra      INT,                             -- nº de produtos OFF na amostra
  nutriscore     CHAR(1),                         -- modal A..E (ou NULL)
  nova_group     TINYINT,                         -- modal 1..4 (ou NULL)
  acucar_med     DECIMAL(6,2),                    -- mediana açúcar/100g
  gord_sat_med   DECIMAL(6,2),                    -- mediana gordura saturada/100g
  sal_med        DECIMAL(6,3),                    -- mediana sal/100g
  dispersao      VARCHAR(10),                     -- 'estreita' | 'larga' (confiança)
  atualizado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- PRODUTO_EAN (migração 020, +item_id na 021): produto identificado por EAN.
-- Guarda o que o VLM extraiu dos rótulos (vlm_json) E o que o Open Food Facts
-- tem para esse EAN (off_json), para alimentar o conselheiro e comparar fontes.
-- item_id NULL = produto consultado/autónomo (scan no mercado ou EAN da linha do
-- talão), SEM ligação a uma compra; item_id preenchido = veio de um item de nota.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE produto_ean (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ean           VARCHAR(20),                 -- código de barras (NULL se não obtido)
  sku_id        BIGINT UNSIGNED,             -- liga ao produto canónico
  item_id       BIGINT UNSIGNED,             -- item da nota de onde veio; NULL = autónomo (migração 021)
  nome          VARCHAR(200),
  marca         VARCHAR(120),
  quantidade    VARCHAR(60),                 -- peso/volume líquido (ex.: "500 g")
  -- conteúdo da embalagem ESTRUTURADO (migração 035; parseado de `quantidade`
  -- por normaliza/conteudo.js): um EAN implica embalagem fixa → o conteúdo é
  -- propriedade do PRODUTO e entra na cadeia do ppb (linha_peso → conteúdo da
  -- ficha via item.ean → formato do SKU → peso_em_falta).
  conteudo_valor   DECIMAL(10,3),            -- 1.000 (kg), 0.500 (kg), 18 (un)
  conteudo_unidade ENUM('kg','L','un'),
  conteudo_pack    SMALLINT,                 -- nº de unidades do multipack (4×125g → 4)
  categoria     VARCHAR(120),
  ingredientes  TEXT,
  alergenios    TEXT,
  validade      VARCHAR(30),                 -- data impressa (texto, como lida do rótulo)
  nutricao      JSON,                        -- por 100 g/ml (melhor fonte disponível)
  fonte         VARCHAR(10),                 -- proveniência do NOME ('auchan','off','vlm','anterior','fusao'…)
  vlm_json      JSON,                        -- bruto do VLM (debug)
  off_json      JSON,                        -- bruto do OFF (debug)
  fusao         JSON,                        -- (052) resolvedor único: {proveniencia:{campo→fonte},
                                             --  divergencias:[…], fontes_hash, fundido_em}
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ean (ean)                    -- MySQL permite vários NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- PRODUTO_FOTO (migração 021): fotos do rótulo (frente, ingredientes, validade)
-- GUARDADAS em disco (/var/lib/bigbag/produtos/, chmod 600), ligadas ao ITEM da
-- nota e/ou ao EAN. Servidas (com auth) por GET /api/produto/foto/:id.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE produto_foto (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  item_id    BIGINT UNSIGNED,           -- item da nota a que a foto pertence
  ean        VARCHAR(20),               -- EAN associado (se houver)
  ficheiro   VARCHAR(255) NOT NULL,     -- caminho do ficheiro guardado (fora do static root)
  mime       VARCHAR(40),
  ordem      TINYINT DEFAULT 0,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pf_item (item_id),
  KEY idx_pf_ean (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- PRODUTO_ANALISE (migração 022): cache da análise factual (LLM) de um produto.
-- Chave = EAN (embalados) OU 'sku:<id>' (frescos genéricos) — a análise depende
-- do PRODUTO, não do item da nota. Re-gera-se apagando a linha (ou ?forcar=1).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE produto_analise (
  ean        VARCHAR(20) PRIMARY KEY,    -- EAN ou 'sku:<id>'
  analise    JSON NOT NULL,
  modelo     VARCHAR(80),
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- PRODUTO_GENERICO (migração 023): caracterização de um produto pelo NOME (sem
-- EAN). Fresco vs. embalado; para frescos (fruta, legume, carne/peixe), nutrição
-- típica por 100 g de tabela de composição. Chave = SKU canónico (partilhada).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE produto_generico (
  sku_id     BIGINT UNSIGNED PRIMARY KEY,
  tipo       VARCHAR(20),          -- 'fresco' | 'processado'
  alimento   VARCHAR(120),         -- alimento genérico identificado
  categoria  VARCHAR(160),
  nutricao   JSON,                 -- por 100 g (só para 'fresco'); NULL para 'processado'
  modelo     VARCHAR(80),
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- PRODUTO_NOME (migração 024): todos os NOMES vistos para um produto (por EAN) —
-- do talão, o canónico, o lido pelo VLM, o do OFF (pode vir noutra língua). Servem
-- para matching de descrições e para construir/afinar o nome canónico. Dedup (ean,nome).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE produto_nome (
  id        BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ean       VARCHAR(20) NOT NULL,
  sku_id    BIGINT UNSIGNED,
  nome      VARCHAR(200) NOT NULL,
  origem    VARCHAR(20),          -- 'talao' | 'canonico' | 'vlm' | 'off'
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ean_nome (ean, nome),
  KEY idx_pn_sku (sku_id),
  KEY idx_pn_ean (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- NOME_SUGESTAO (migração 025): sugestão de nome canónico (LLM, das variantes em
-- produto_nome) para o operador rever na aba "Nomes" do /admin. Uma por SKU.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE nome_sugestao (
  sku_id      BIGINT UNSIGNED PRIMARY KEY,
  atual       VARCHAR(200),
  sugerido    VARCHAR(200) NOT NULL,
  variantes   TEXT,                                    -- variantes separadas por '||'
  estado      VARCHAR(12) NOT NULL DEFAULT 'pendente', -- pendente | aplicado | rejeitado
  criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decidido_em TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- PERFIL_MEMBRO (migração 026): perfil nutricional por membro do agregado
-- (carregado de um texto gerado por LLM dos exames/objetivos/cardápio). Guarda o
-- texto bruto (nuance) + um resumo estruturado (alertas determinísticos). UM perfil
-- ATIVO de cada vez (é o usado nas avaliações personalizadas).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE perfil_membro (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  nome          VARCHAR(80) NOT NULL,
  texto         MEDIUMTEXT,        -- perfil em texto (bruto)
  resumo        JSON,              -- { objetivos, restricoes, alergias, intolerancias, condicoes, preferir, evitar, nutrientes, notas }
  ativo         TINYINT DEFAULT 0, -- 1 = perfil usado nas avaliações personalizadas
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Notas de design — identificação de produto
- **EAN é a identidade forte do produto.** Sempre que entra um EAN (manual, lido na foto, ou impresso na linha do talão), é **validado pelo dígito verificador** (`eanValido`, check-digit GTIN-8/12/13) ANTES de gravar. Um código que falha o dígito verificador é descartado (`ean_rejeitado`) para não criar produtos-fantasma. O `item.ean` (da linha do talão) é **autoritativo** sobre o lido à mão e dispensa foto.
- **Duas vias de nutrição, por confiança:** EAN/rótulo (preciso, por produto) vs. genérico por categoria/nome (estimado). Frescos (fruta/legume/carne) herdam nutrição de tabela de composição via `produto_generico`; embalados ficam com `nutricao NULL` no genérico (a nutrição vem do rótulo, não se inventa).
- **Cache em todo o lado:** `consultarOFF` por EAN, análise factual em `produto_analise` (chave EAN ou `sku:<id>`), nutrição de categoria em `categoria_nutricao`. Re-geração explícita (`?forcar=1` / apagar a linha).
- **Fotos guardadas em disco** (não na BD), ligadas ao item; o caminho fica em `produto_foto.ficheiro` e é servido com auth (nunca via static root).

### 1c. Catálogo, matching de EAN e telemetria (migrações 028–032)
- **`catalogo_produto` (028/029):** catálogo multi-fonte com **EAN por nome PT** (scrapes Auchan/Continente — só esses expõem EAN em HTML estático). Chave `fonte`+`sku_fonte` UNIQUE; campos `nome, marca, categoria_path, ean, formato/formato_valor, preco, url, imagem`. Dá candidatos de EAN/ficha aos itens do talão **sem EAN** (`src/normaliza/resolverProduto.js`, `mestreEan.js`).
- **`match_ean_sugestao` (030, +métricas 031):** propostas de EAN por matching de nome do talão → catálogo, para o operador rever na **aba EANs** (uma por descrição; estado pendente/aprovado/rejeitado, **sem LLM — o operador é o juiz**). A 031 acrescenta `preco_pago/preco_cand/formato_pago/formato_cand` para comparar (mesma loja: preço≈preço e formato≈formato confirmam).
- **`evento_uso` (032):** **telemetria de USO** self-hosted (sem terceiros, NUNCA conteúdo — só QUAL ação). Campos `fonte` (api|ui), `utilizador`, `sessao` (id por visita, sem fingerprint), `evento`, `props` JSON, `criado_em`. `api` = middleware (`src/telemetria.js`) regista o **padrão da rota** de cada pedido `/api`; `ui` = ações só-frontend (`track()`) via `POST /api/telemetria`. Mapa na **aba Uso** do `/admin` (`GET /admin/uso?dias=`).

### 1d. Tabelas e colunas posteriores (migrações 033–052; DDL nas próprias migrações)
- **`produto_mestre` (017, facetas-colunas em 043):** o **Produto Mestre facetado** — agrupa SKUs comparáveis (várias marcas/tamanhos do mesmo equivalente). `chave` UNIQUE = tuplo de 10 slots por `|` (`categoria|apresentacao|corte|processamento|variedade|sabor|teor|estilo|funcao|fonte`, `normaliza/mestre.js chaveMestre`); a 043 **materializou os 9 slots não-categoria como COLUNAS** (`facetasDaChave` = split puro, sem LLM) → SQL pode filtrar/agrupar por `teor='magro'`, `estilo='grego'`, `sabor='morango'`. `sku_normalizado.mestre_id` liga. **Resolve a crítica "string ≠ taxonomia" pela via facetada** (níveis = projeções de colunas, não árvore): "iogurte magro" casa "…Natural **Ligeiro**" pela coluna `teor`, impossível pelo nome. Ver `Taxonomia_Produto.md §11`.
- **`produto_ean` — `nutricao_confirmada` (033)** + **conteúdo estruturado (035):** `nutricao_confirmada=0` isola nutrição lida só por VLM (provisória) até operador/OFF confirmar; `conteudo_valor/unidade/pack` (parse de `quantidade` por `conteudo.js`) entram na cadeia do ppb.
- **`lista_item` / `lista_pessoal` (034; `ean` em 050):** lista de compras PARTILHADA da família (servidor é fonte de verdade); estados `ativo|carrinho|comprado|removido`, `adicionado_por`/`marcado_por` (cor do membro), `fatura_id` (reconciliação), **`ean` (050)** = código de barras quando o item entra por scan (liga ao produto EXATO: preço de referência, marca, tamanho). `lista_pessoal` = listas individuais (UNIQUE user+nome). **Lista inteligente fase 1 (2026-06-11, derivado do histórico em runtime):** `produto_sugerido`/`variantes_n`/`qtd_habitual` por item; `GET /lista/variantes?nome=`; `PATCH :id {nome}` concretiza. **Sprints 1–2 + lista mágica (2026-06-11/12):** consolidação por `chaveItemLista` (plurais/acentos somam, não duplicam); `POST /lista/lote` (voz, 1 round-trip); `PATCH {inc}` delta concorrente; `GET /lista` com **ETag/304** (assinatura inclui mercado, MAX(item.id) e `versaoPesoImg`); `POST /limpar` devolve snapshot e `POST /restaurar` repõe (Desfazer); `GET /lista/sugestoes` (cadência mediana por SKU, urgência 0,85–3×, zero LLM); `GET /lista/refeicoes` (única chamada LLM da lista, cache por hash dos itens). Por item a API resolve ainda `marca` (catálogo > ficha por EAN > deteção no nome), `tamanho` (quantidade da ficha → formato do catálogo → match por nome → peso-pela-imagem), **`cat_exib`** (a FAMÍLIA do voto-por-catálogo, seção de exibição — regra do dono 2026-06-13; tipos curados salientes agregam por cima no cliente) e a **cadeia de preço completa (v0.0.147.0)**: FACTO por nome→SKU **e por EAN** (`item.ean` do talão + `produto_ean.item_id` da identificação — caso Picles-Aldi, 2026-06-14) → `preco_ref` "online" (MENOR preço de catálogo do EAN) → `preco_ref_tipo='estimado'` em 3 níveis (irmão mesma-marca → primo mesmos-distintivos → primo família+distintivos-de-dieta) → nada. Preço de catálogo é só referência, nunca critério.
- **`verificacao_nome` (037):** registo da 2.ª opinião de leitura (`lido`/`opiniao`/scores/`resultado` confirmado|corrigido|duvida) — ground truth p/ harness de leitores.
- **`off_produto` (038):** extrato LOCAL do dump do Open Food Facts (~27k: PT + marcas próprias dos mercados); `consultarOFF` é **local-first** (esta tabela antes da API). DAG de categorias em `categorias_tags`/`grupos_alimento`.
- **`catalogo_produto.nome_pt` (040):** tradução PT do nome (catálogos em ES, ex. Mercadona) — `buscarCatalogo` tokeniza `nome_pt||nome` para o talão PT casar na própria cadeia.
- **`custo_chamada`:** custo de CADA chamada LLM/VLM (`contexto`=feature, `modelo`, tokens, `custo`). **Todas** as chamadas registam (incl. as que usavam fetch direto). Aba **Custos** do `/admin` (`GET /admin/custos?dias=`): gasto por feature/modelo/dia.
- **Migrações 044–048 (consolidação de catálogo/fichas):** 044 `produto_ean` campos largos (categoria 255/validade 60 — OFF estourava varchar e abortava INSERTs); 045 `catalogo_produto.ean_inferido` (matching nome→EAN por 4 sinais, operador é juiz); 046 `catalogo.descricao_curta` (verbatim PD); 047 `catalogo.nutricao/nutricao_base/ingredientes` (nutrição OFICIAL de loja raspada do HTML — Auchan ~7,5k; passa a 3.ª fonte de nutrição e a melhor p/ ingredientes+alergénios); 048 **colação única** (`catalogo_produto`→utf8mb4_unicode_ci; era a única tabela em 0900_ai_ci e causou 3 "Illegal mix of collations" num dia).
- **`despensa` (049):** inventário do que a casa TEM, alimentado por **scan** (decisão 2026-06-12 — substitui a despensa derivada de compras, que não dizia o que ainda há em casa). 1 linha/EAN (UNIQUE; re-scan atualiza `atualizado_em`), `nome` PT no momento do scan, `marca`, `validade`, `utilizador`. O scan-para-lista grava na lista E aqui.
- **`catalogo_produto.peso_img_em` (051):** marcador tentado-uma-vez da ferramenta **peso-pela-imagem** (`ingest/pesoImagem.js`): NULL=por tentar; data+formato preenchido=peso lido da imagem; data+formato "Nun"=tentado sem sucesso (não repete o custo VLM).
- **`normaliza/classificarCatalogo.js` (sem migração — runtime):** classificação POR CATÁLOGO (Fase D): `classificarPorCatalogo(pool,{nome,ean})` — voto das linhas diretas (EAN) ou dos top-80 vizinhos por nome, ponderado pela profundidade do caminho, vencedor por **FAMÍLIA** (2.º nível); flag `fiavel` (via-EAN sempre; vizinhança conf≥0.5 e ≥5 + guarda anti-colisão por sobreposição de tokens nome↔catálogo); `exibirFolha` re-acentua slugs. Consumidores: lista (`cat_exib` + grupo-fallback). Avaliador: `scripts/avaliar_classificacao_catalogo.mjs`.
- **`cortarQuantidadeNome` (categoria.js, partilhada):** quantidade embutida no nome sai (par "20 Saq"/"2 Rolos" + unidade órfã no fim); usada na fusão (`limparNomeProduto`) e na exibição da lista.
- **`produto_ean.fusao` (052) — RESOLVEDOR ÚNICO da ficha por EAN (2026-06-13):** a ficha deixa de ser "first-wins com remendos" e passa a ser a **FUSÃO campo-a-campo de TODAS as fontes locais** (linhas de `catalogo_produto` do EAN + dump `off_produto` + `off_json` live + `vlm_json`), com a **tabela de prioridades num só sítio** (`normaliza/fichaEan.js`, caixa no topo): marca = catálogo(moda)>OFF>VLM; tamanho = VLM>OFF>catálogo; **nome** = candidatos PT *limpos de marca+formato* → colapso → consenso de tokens (≥2 fontes) vence órfãos de marketing, nativo>traduzido-por-léxico, nunca vazio; categoria = caminho de loja PT mais fundo; **nutrição INVERTIDA**: catálogo-oficial(047)>OFF>VLM-plausível; **ingredientes** = o MAIS COMPLETO (com penalização de lixo-OCR e de língua estrangeira — PT vence ES/FR/IT de igual tamanho); alergénios = preferência PT (alimentam os alertas do perfil) com 'Leite' a vencer 'en:milk'. O JSON `fusao` guarda `proveniencia` por campo, `divergencias` (só registo, sem worklist — decisão do dono), `fontes_hash` (re-fusão barata: mesmo hash → skip write) e `fundido_em`. **'manual' é sagrado** (nunca sobrescrito); o valor `anterior` (já gravado) concorre — é assim que a **tradução LLM** (`garantirFichaPT`, que corre FORA da fusão) sobrevive a re-fusões. `consultarOuGuardar` e `POST /identificar` delegam aqui; **OFF live só quando nada local dá nome**. Backfill `scripts/refundir_fichas.mjs` (aplica + regista diff JSONL p/ revisão — decisão do dono); idempotência provada (ronda final: 0 mudanças em 206 fichas). `fonte` da linha passa a registar a proveniência do NOME.

### Notas de design
- **`preco_por_base` é o que faz a comparação funcionar.** Para itens por peso (fruta a granel), `preco_liquido` sozinho não é comparável; `preco_por_base` (€/kg) é. Para itens por unidade, é o preço por unidade. As funções de comparação consultam sempre `preco_por_base`.
- **`preco_liquido` = preço impresso na linha, NÃO raspado pelo desconto de cartão.** O desconto global ("Desconto Cartão Utilizado") é um desconto da NOTA aplicado no pagamento, não atribuível a produtos — espalhá-lo cêntimo a cêntimo distorcia cada preço (um sumo de 2,49 aparecia como 2,37). Fica só em `fatura.desconto_global`. Consequência: `Σ preco_liquido` = subtotal (valor dos produtos), não o total pago; a diferença é o benefício do cartão.
- **`total_reconciliado` vs `total_impresso`** é a tua métrica de qualidade da extração embutida no schema: se não baterem (`Σbase − desconto_global ≠ total`), a extração perdeu/inventou/leu mal um item ou um desconto.
- **`metodo_extracao`** na fatura permite-te, mais tarde, comparar VLM vs OCR+LLM em dados reais (a tua experiência) — sabes que abordagem gerou cada registo.
- **`is_clearance` / `is_non_product`** são as flags das regras de negócio; as funções de consulta filtram-nas para não poluir o histórico.
- **`descricao_original`** é o **nome limpo** do produto (qtd/peso/preço/IVA vão para os campos próprios: `quantidade`, `linha_peso`, `preco_*`, `taxa_iva`). A extração estruturada (`peso_kg`/`preco_base_impresso`) entrega-o limpo na origem; `limparDescricao` é a rede de segurança. **Fonte de auditoria do que foi lido = a imagem da nota** (`ficheiro_original`) + o `extracao_json`.
- **Normalização de SKU corre na ingestão (Camadas 1-3).** Logo após gravar a fatura, cada item é resolvido para um `sku_normalizado` (alias-cache → canonicalização por LLM → match por similaridade); o script de lote `normalizar_skus` é a rede de segurança para o que ficar sem SKU. A canonicalização **corrige erros óbvios de leitura/OCR** ("OLO GIRASSOL"→"Óleo de Girassol", "RUPA TOMATE"→"Polpa de Tomate") usando conhecimento de produto — mas com guarda-corpos: **nunca altera números** (quantidade/preço vêm intactos da extração, não passam por esta camada), **nunca inventa** (se ilegível/ambíguo, baixa a confiança e o item fica para revisão com `sku_id` null), e a imagem da nota fica sempre para auditoria. As consultas mostram `COALESCE(nome_canonico, descricao_original)`, por isso o nome corrigido aparece automaticamente.
- **Interface de operador (`/admin`) + tabela `revisao` (migração 011).** Tela desktop para gerir SKUs canónicos (renomear, associar/dissociar descrições, fundir dois produtos) e rever a leitura de cada nota (imagem + itens, marcar certa/errada com comentário). API em `/api/admin/*` (protegida); a imagem da nota vem de `GET /api/faturas/:id/imagem`. A tabela `revisao` (fatura_id, veredicto ok/erro, comentário, operador) guarda o feedback humano — o sinal para priorizar melhorias por mercado/produto. A **aba Revisão** (`GET /api/admin/baixa-confianca`) é uma worklist ordenada por confiança: itens sem SKU (não resolvidos) + mapeamentos de baixa confiança (`sku_alias.confianca` < limiar), do pior para o melhor; os legados sem pontuação (NULL) contam à parte e pontuam-se ao reprocessar.

---

## 2. Funções de Tool Use (contrato para o LLM)

Formato compatível com OpenRouter / OpenAI tools. O LLM recebe a consulta (transcrita ou escrita) e escolhe a função; o backend executa a query e devolve JSON; o LLM formula a resposta em português.

```json
[
  {
    "type": "function",
    "function": {
      "name": "buscar_ultima_compra",
      "description": "Devolve a compra mais recente de um produto: preço pago, loja e data. Usar quando o utilizador pergunta quanto pagou ou onde comprou um produto da última vez.",
      "parameters": {
        "type": "object",
        "properties": {
          "produto": {
            "type": "string",
            "description": "Nome do produto em linguagem natural, ex. 'manteiga', 'leite meio-gordo'. O backend faz a correspondência ao SKU canónico."
          }
        },
        "required": ["produto"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "comparar_precos_por_loja",
      "description": "Compara o preço de um produto entre as várias lojas, do mais barato ao mais caro, usando o preço por unidade-base (€/kg, €/L ou €/un). Usar para perguntas do tipo 'onde está mais barato'. Exclui itens em fim de validade.",
      "parameters": {
        "type": "object",
        "properties": {
          "produto": {
            "type": "string",
            "description": "Nome do produto em linguagem natural."
          }
        },
        "required": ["produto"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "historico_preco",
      "description": "Devolve a evolução do preço de um produto ao longo do tempo (lista de preço por data e loja). Usar para perguntas sobre subida/descida de preço ou 'quanto custava antes'.",
      "parameters": {
        "type": "object",
        "properties": {
          "produto": {
            "type": "string",
            "description": "Nome do produto em linguagem natural."
          },
          "desde": {
            "type": "string",
            "description": "Data inicial opcional, formato ISO 'YYYY-MM-DD'. Se omitida, todo o histórico."
          }
        },
        "required": ["produto"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "total_gasto",
      "description": "Soma quanto foi gasto num produto, categoria, ou no total, num período. Usar para 'quanto gastei em X este mês/ano'.",
      "parameters": {
        "type": "object",
        "properties": {
          "alvo": {
            "type": "string",
            "description": "Produto ('café'), categoria ('Laticínios'), ou 'tudo' para o total geral."
          },
          "periodo_inicio": {
            "type": "string",
            "description": "Data inicial ISO 'YYYY-MM-DD'."
          },
          "periodo_fim": {
            "type": "string",
            "description": "Data final ISO 'YYYY-MM-DD'. Se omitida, até hoje."
          }
        },
        "required": ["alvo", "periodo_inicio"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "tendencia_precos",
      "description": "Produtos que ficaram MAIS CAROS ou MAIS BARATOS ao longo do tempo: variação % entre a 1ª e a última observação de cada produto (preço por unidade-base). Usar para 'que produtos subiram/desceram de preço', 'o que ficou mais caro/barato ultimamente', 'tendência de preços'.",
      "parameters": {
        "type": "object",
        "properties": {
          "desde": { "type": "string", "description": "Opcional ISO 'YYYY-MM-DD'. Para 'ultimamente/recentemente', ~90 dias atrás. Omitido = todo o histórico." },
          "loja": { "type": "string", "description": "Opcional: cadeia/loja." }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "comparar_lojas",
      "description": "Que CADEIA/supermercado tende a ser mais barato para os produtos do usuário. Compara o preço por unidade-base dos produtos vistos em ≥2 lojas e ordena as lojas por 'vitorias_pct' (% de vezes que é a mais barata). Usar para 'onde costumo comprar mais barato', 'qual o supermercado mais barato para mim'. Sem parâmetros.",
      "parameters": { "type": "object", "properties": {}, "required": [] }
    }
  }
]
```

### Notas sobre o contrato
- **Correspondência produto → SKU é do backend, não do LLM.** O LLM passa "manteiga" em texto livre; o backend resolve para o(s) SKU(s) canónico(s) — provavelmente fuzzy match / embeddings sobre `nome_canonico`. Isto isola a parte difícil (a normalização) numa camada testável, em vez de a empurrar para o prompt.
- **Datas sempre ISO** no contrato; o LLM converte "este mês" → intervalo antes de chamar (ou o backend interpreta — decidir na implementação, mas ISO no contrato evita ambiguidade).
- **Filtros implícitos:** as comparações e históricos excluem `is_clearance` e `is_non_product` por omissão. A poupança de fim-de-validade pode ser uma função futura à parte.
- **Resposta do backend → LLM:** JSON simples e achatado (ex. `{"produto":"manteiga Mimosa","preco":2.19,"loja":"Pingo Doce","data":"2026-05-28"}`), para o LLM formular naturalmente.

---

## 2b. Rotas HTTP (contrato da API) — todas atrás de `requireAuth`

Resumo das rotas montadas em `backend/src/routes/`. Todas exigem sessão (portão temporário `ENABLE_TEST_AUTH` até o OAuth ficar ativo).

### Faturas — `/api/faturas` (`faturas.js`)
- **`POST /`** — ingestão (multipart, campo `fatura` = imagem **ou** PDF; campo opcional `origem` = `scan|foto|galeria|arquivo`). PDF → texto+LLM; imagem → VLM. Auto-correção em loop (realimenta discrepância do total + linhas inconsistentes), normalização (formato → `preco_por_base`), persistência com **deduplicação endurecida**, canonicalização inline (resolve `sku_id`), recompute de ppb, auto-correção de outliers, merge de nomes idênticos, e **enriquecimento OFF dos EANs vindos na linha do talão** (Makro → `produto_ean` autónomo). Devolve resumo + sinal de qualidade (`extracao_bate`, `needs_review`, `discrepancia`, itens). Se duplicada: `{ duplicada:true, fatura_id }` e apaga a imagem órfã.
- **`GET /`** — lista de notas (data, loja, nº de itens, total), data desc.
- **`GET /gastos`** — resumo de gastos doméstico: `{ atual, anterior, media, total_geral, variacao, serie }` (série mensal, últimos 12 meses) + `por_loja` do mês corrente. (Declarada ANTES de `/:id` para não colidir.)
- **`GET /:id`** — itens de uma nota. Por item devolve agora também **`ean`** (`COALESCE(item.ean, EAN da identificação por foto)`), **`marca`** (do OFF/VLM), **`tipo_alimento`** (`produto_generico.tipo`) e `tem_generico` — para a app mostrar identificação/nutrição.
- **`GET /:id/imagem`** — serve a imagem original (revisão do operador).

### Produto / conselheiro de saúde — `/api/produto` (`produto.js`)
- **`POST /identificar`** (multipart `fotos[]` ≤10, + `ean`/`sku_id`/`item_id` opcionais) — corre o **VLM** sobre as fotos do rótulo E consulta o **OFF** pelo EAN; valida o EAN pelo dígito verificador (`ean_rejeitado` se falhar); guarda as fotos em disco (ligadas ao item) e faz upsert em `produto_ean` + `produto_nome` — **a ficha gravada é a FUSÃO** (`fundirFichaEan`, ver migração 052), com o VLM/OFF desta chamada como fontes extra. Devolve `{ ean, vlm, off, fonte, custo, n_fotos, fotos_guardadas, ean_rejeitado }`.
- **`GET /info`** (`item_id` **ou** `ean`) — consolida TUDO o que sabemos do produto: funde as várias linhas de `produto_ean` (vlm/off), inclui o genérico (frescos) e lista as fotos. EAN do talão é autoritativo.
- **`GET /analise`** (`item_id` ou `ean`, `?forcar=1`) — análise **factual e não clínica** (ingredientes, NOVA, Nutri-Score, destaques), cacheada em `produto_analise` (chave EAN ou `sku:<id>`).
- **`GET /personalizado`** (`item_id` ou `ean`) — avaliação à luz do **perfil ativo**: alertas determinísticos (`alertasDoPerfil`) + parecer do LLM (`avaliarParaPerfil`). `{ perfil:null }` se não houver perfil ativo.
- **`POST /ler-ean`** (multipart `foto`) — VLM lê os dígitos do código de barras de uma foto (fallback do scanner ao vivo); valida o dígito verificador.
- **`GET /consultar`** (`?ean=`, `?pt=1`) — consulta por EAN SEM ligação a nota (scan no mercado): nossa base → OFF → catálogo; guarda (`item_id` NULL) para uso futuro. **Resolução do NOME é PT-first** (`nomeCatalogoPt`: nome de loja PT do catálogo para o MESMO EAN ganha ao OFF estrangeiro; senão tradução LLM — em fundo na ficha, **síncrona com `?pt=1`** para o scan→lista nunca mostrar FR/EN/ES). EAN que não resolve em lado nenhum é **registado** (`fonte='pendente'`) em vez de descartado. `{ ean, encontrado, fonte, nome }`.
- **`POST /foto`** (multipart `foto`) — câmara "inteligente": classifica a foto (`talao`/`produto`/`outro`); se produto, tenta o EAN (rótulo ou OFF-por-nome) e devolve a consulta.
- **`GET /despensa`** — inventário por SCAN (tabela `despensa`, 049), ordenado pelo scan mais recente. **`POST /despensa`** (`{ean, nome?}`) — upsert por EAN ("tenho isto em casa"); completa nome PT/marca/validade pela ficha. **`DELETE /despensa/:ean`** — tira (consumido/engano).
- **`GET /por-identificar`** — worklist de itens embalados (não-frescos) sem EAN identificado, por compra desc.
- **`GET /foto/:id`** — serve uma foto de produto (caminho da BD, com auth).

### Perfil nutricional — `/api/perfil` (`perfil.js`)
- **`GET /`** — lista perfis (com resumo), o ativo primeiro.
- **`POST /`** (`{ nome, texto }`) — carrega/atualiza um perfil: extrai o `resumo` estruturado (LLM) e fica **ativo** (upsert por nome; ativa só este).
- **`POST /:id/ativar`** — torna esse perfil o ativo (`ativo = IF(id=?,1,0)`).

### Operador — `/api/admin` (`admin.js`)
- **Nomes:** `GET /nomes` (sugestões pendentes), `POST /nomes/gerar` (LLM das variantes em `produto_nome`), `POST /nomes/:skuId/aplicar` (renomeia, guarda anti-colisão → 409), `POST /nomes/:skuId/rejeitar`.
- **EANs:** `GET /match-eans` + `POST /match-eans/gerar` (propostas de EAN por matching de nome → `match_ean_sugestao`), `POST /match-eans/:id/aprovar|rejeitar` (ao aprovar, o produto ganha ficha+nutrição; propaga o EAN aos irmãos OCR).
- **SKUs:** `POST /skus/merge` (funde `de`→`para`; **preserva** itens + `sku_alias` + `produto_nome` + `produto_ean` + genérico — nomes de talão intactos p/ matching futuro), `POST /skus/auto-merge`.
- **Itens** (inspeção/correção do item cru): `GET /itens?q=&ordenar=loja&todos=1` (todas as propriedades extraídas; por defeito só com EAN ou a precisar; colapsa iguais), `GET /itens-resumo` (cartões EANs distintos / por-identificar), `POST /itens/:id/ean` (define/limpa o EAN à mão — valida dígito verificador + enriquece ficha por OFF/catálogo), `PATCH /itens/:id` (edita qualquer campo; dar peso recalcula €/base e limpa `peso_em_falta`).
- **Uso** (telemetria): `GET /uso?dias=` — mapa por funcionalidade (usos · última vez · quem). Eventos `ui` entram por `POST /api/telemetria` (top-level, `server.js`).

### Funções de apoio (ingestão)
- **`ingest/produto.js`:** `extrairProdutoFotos` (VLM sobre N fotos), `consultarOFF` (Open Food Facts por EAN), `analisarProduto` (análise factual), `caracterizarProdutoNome` (fresco vs. processado + nutrição típica), `sugerirNomeCanonico` (melhor nome PT genérico das variantes), `eanValido` (check-digit GTIN-8/12/13), `lerEanDeFoto`, `analisarFotoProduto` (classifica talão/produto/outro), `buscarOffPorNome`.
- **`ingest/perfil.js`:** `extrairPerfil` (texto → resumo estruturado), `alertasDoPerfil` (determinístico; grupos de sinónimos de alergénios PT↔EN/OFF, limpa prefixos `en:`/`pt:`), `avaliarParaPerfil` (parecer do LLM, factual não clínico).
- **Modelos:** VLM de extração de fotos = `gemini-2.5-flash` (`OPENROUTER_MODEL_EXTRACAO`); análise / consulta / caracterização / perfil = `modelConsulta` (`gemini-2.5-flash`).

#### Deduplicação de faturas (endurecida — `ingest/persist.js`)
Quatro redes, em cascata, para sobreviver a erros de leitura do VLM (nome de loja, data):
1. **Número do documento por CADEIA** (`l.cadeia = ? AND numero_fatura = ?`) — o critério mais fiável; sobrevive a `loja_id` diferente por nome mal lido.
2. **Por loja:** `numero_fatura` OU `DATE(data_compra) = DATE(?) AND total_impresso` (apanha as antigas sem número).
3. **Assinatura forte:** cadeia + `DATE()` igual + total + nº de itens (praticamente impossível colidir entre compras distintas).
4. **Sobreposição de preços:** cadeia + total + nº de itens, confirmada por interseção dos `preco_liquido` (`sobreposicaoPrecos`, tolerância ±0,02 de OCR; exige ≥70% de sobreposição). Apanha duplicados com data/preços lidos de forma diferente entre leituras.

`item.ean` (EAN da linha do talão) é gravado só se passar `eanValido`.

---

## 3. Notas de implementação v1 (2026-06-05) — suposições registadas

Implementação inicial das 4 funções em `backend/src/queries.js`, com teste de integração (`backend/test/queries.test.mjs`, 7 casos, transação + `ROLLBACK`). Decisões tomadas com autonomia (reversíveis), a confirmar/afinar:

- **Correspondência produto→SKU = LIKE ingénuo v1.** `matchProduto()` faz `LIKE '%termo%'` sobre `nome_canonico`, `marca` e `descricao_original`. É o ponto de troca para fuzzy/embeddings (conceito §4.2); está isolado numa função para não mexer nas queries quando evoluir. A collation `utf8mb4_unicode_ci` dá match insensível a maiúsculas/acentos de borla.
- **`buscar_ultima_compra`** exclui `is_non_product` mas **inclui** `is_clearance` (é uma compra real); devolve a flag `is_clearance` para o caller saber.
- **`comparar_precos_por_loja`** usa a observação **mais recente por loja** (`ROW_NUMBER()`), exclui clearance/não-produto e exige `preco_por_base IS NOT NULL`.
- **`total_gasto`** exclui `is_non_product` e **inclui** `is_clearance` (gasto real). `'tudo'` = total de gasto **em produtos** (sacos/taxas fora), não a fatura bruta — reversível se preferires o total absoluto. `alvo` casa categoria **ou** produto.
- **Datas de saída** via `DATE_FORMAT(...,'%Y-%m-%d')` → strings ISO no JSON (não objetos `Date`).
- **Sem rota HTTP de consulta ainda.** As funções são uma biblioteca testável; a exposição por endpoint fica **atrás de auth** (requisito de segurança), a implementar com o OAuth.

### Adições (2026-06-06) — `tendencia_precos` e `comparar_lojas`
- **`tendencia_precos`** — para cada produto com ≥2 observações de `preco_por_base` em datas diferentes, compara a 1ª e a última (via `FIRST_VALUE` em janelas asc/desc) e devolve a variação %, ordenado pelo maior movimento. Exclui clearance/não-produto/revisão. *"Ultimamente"* → o LLM passa `desde` ≈ 90 dias atrás. (Nota: alguns movimentos extremos refletem ruído de formato a montante, não preço real — é o sinal honesto da `preco_por_base`.)
- **`comparar_lojas`** — para os produtos vistos em **≥2 cadeias**, compara o `preco_por_base` mais recente por cadeia ao mínimo; ordena as cadeias por **`vitorias_pct`** (% de produtos em que é a mais barata). O `premio_medio_pct` é **limitado a 100%/produto** para um outlier não dominar a média. Devolve `produtos_comparados` para o LLM assinalar amostras pequenas. Vazio se não houver produtos comparáveis (honesto).
- **Modelo de consulta = `gemini-2.5-flash` (full)**, não o "lite": o lite era inconsistente a chamar ferramentas (ora chamava, ora devolvia bolha vazia). A consulta é fração mínima do custo. Defensivas no loop: normalização do nome da ferramenta (modelos que prefixam `namespace.funcao`, ex. `default_api.detalhes_fatura`) e guarda anti-resposta-vazia.

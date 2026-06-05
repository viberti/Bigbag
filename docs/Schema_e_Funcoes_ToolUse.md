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
  categoria     VARCHAR(80),                     -- 'Mercearia Doce', 'Laticínios'...
  -- unidade-base para comparação de preço (ver nota de design sobre quantidades):
  unidade_base  ENUM('un','kg','L') NOT NULL DEFAULT 'un',
  formato_valor DECIMAL(10,3),                   -- 0.425 (kg), 1.000 (L), 1 (un)
  criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sku_nome (nome_canonico),
  KEY idx_sku_categoria (categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- FATURA: uma compra. Guarda total impresso E reconciliado para
-- validar a extração (devem bater após distribuir descontos globais).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE fatura (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  loja_id             BIGINT UNSIGNED NOT NULL,
  data_compra         DATETIME NOT NULL,
  total_impresso      DECIMAL(10,2) NOT NULL,    -- o que vinha escrito na fatura
  total_reconciliado  DECIMAL(10,2),             -- soma dos itens após regras; deve ≈ total_impresso
  discrepancia        DECIMAL(10,2),             -- Σbase − desconto − total; 0 = extração bate (migração 003)
  needs_review        BOOLEAN DEFAULT FALSE,     -- TRUE se não bate; EXCLUÍDA das análises de preço (migração 003)
  extracao_json       JSON,                      -- snapshot do que o VLM extraiu, p/ debug (migração 003)
  desconto_global     DECIMAL(10,2) DEFAULT 0,   -- ex. Cartão Continente, antes de distribuir
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
  descricao_original   VARCHAR(200) NOT NULL,     -- 'BOL DIGESTIVE AVEIA CNT 425GR'
  quantidade           DECIMAL(10,3) NOT NULL DEFAULT 1,  -- 3 (un) ou 0.418 (kg)
  preco_unitario       DECIMAL(10,4),             -- preço por unidade tal como na fatura
  preco_liquido        DECIMAL(10,2) NOT NULL,    -- pago de facto neste item (após descontos)
  preco_por_base       DECIMAL(10,4),             -- preço normalizado p/ unidade_base do SKU (€/kg, €/L, €/un)
  is_clearance         BOOLEAN DEFAULT FALSE,     -- fim de validade: isolar da série histórica
  desconto_direto      DECIMAL(10,2) DEFAULT 0,   -- 'Poupança' na linha
  is_non_product       BOOLEAN DEFAULT FALSE,     -- saco, taxa: fora do histórico de preços
  CONSTRAINT fk_item_fatura FOREIGN KEY (fatura_id) REFERENCES fatura(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sku FOREIGN KEY (sku_id) REFERENCES sku_normalizado(id),
  KEY idx_item_sku (sku_id),
  KEY idx_item_fatura (fatura_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Notas de design
- **`preco_por_base` é o que faz a comparação funcionar.** Para itens por peso (fruta a granel), `preco_liquido` sozinho não é comparável; `preco_por_base` (€/kg) é. Para itens por unidade, é o preço por unidade. As funções de comparação consultam sempre `preco_por_base`.
- **`total_reconciliado` vs `total_impresso`** é a tua métrica de qualidade da extração embutida no schema: se não baterem, a extração ou a distribuição de desconto falhou.
- **`metodo_extracao`** na fatura permite-te, mais tarde, comparar VLM vs OCR+LLM em dados reais (a tua experiência) — sabes que abordagem gerou cada registo.
- **`is_clearance` / `is_non_product`** são as flags das regras de negócio; as funções de consulta filtram-nas para não poluir o histórico.
- **`descricao_original`** nunca se perde — é o que permite depurar a normalização e treinar/ajustar.
- **Normalização de SKU corre na ingestão (Camadas 1-3).** Logo após gravar a fatura, cada item é resolvido para um `sku_normalizado` (alias-cache → canonicalização por LLM → match por similaridade); o script de lote `normalizar_skus` é a rede de segurança para o que ficar sem SKU. A canonicalização **corrige erros óbvios de leitura/OCR** ("OLO GIRASSOL"→"Óleo de Girassol", "RUPA TOMATE"→"Polpa de Tomate") usando conhecimento de produto — mas com guarda-corpos: **nunca altera números** (quantidade/preço vêm intactos da extração, não passam por esta camada), **nunca inventa** (se ilegível/ambíguo, baixa a confiança e o item fica para revisão com `sku_id` null), e o `descricao_original` cru fica sempre para auditoria. As consultas mostram `COALESCE(nome_canonico, descricao_original)`, por isso o nome corrigido aparece automaticamente.

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
  }
]
```

### Notas sobre o contrato
- **Correspondência produto → SKU é do backend, não do LLM.** O LLM passa "manteiga" em texto livre; o backend resolve para o(s) SKU(s) canónico(s) — provavelmente fuzzy match / embeddings sobre `nome_canonico`. Isto isola a parte difícil (a normalização) numa camada testável, em vez de a empurrar para o prompt.
- **Datas sempre ISO** no contrato; o LLM converte "este mês" → intervalo antes de chamar (ou o backend interpreta — decidir na implementação, mas ISO no contrato evita ambiguidade).
- **Filtros implícitos:** as comparações e históricos excluem `is_clearance` e `is_non_product` por omissão. A poupança de fim-de-validade pode ser uma função futura à parte.
- **Resposta do backend → LLM:** JSON simples e achatado (ex. `{"produto":"manteiga Mimosa","preco":2.19,"loja":"Pingo Doce","data":"2026-05-28"}`), para o LLM formular naturalmente.

---

## 3. Notas de implementação v1 (2026-06-05) — suposições registadas

Implementação inicial das 4 funções em `backend/src/queries.js`, com teste de integração (`backend/test/queries.test.mjs`, 7 casos, transação + `ROLLBACK`). Decisões tomadas com autonomia (reversíveis), a confirmar/afinar:

- **Correspondência produto→SKU = LIKE ingénuo v1.** `matchProduto()` faz `LIKE '%termo%'` sobre `nome_canonico`, `marca` e `descricao_original`. É o ponto de troca para fuzzy/embeddings (conceito §4.2); está isolado numa função para não mexer nas queries quando evoluir. A collation `utf8mb4_unicode_ci` dá match insensível a maiúsculas/acentos de borla.
- **`buscar_ultima_compra`** exclui `is_non_product` mas **inclui** `is_clearance` (é uma compra real); devolve a flag `is_clearance` para o caller saber.
- **`comparar_precos_por_loja`** usa a observação **mais recente por loja** (`ROW_NUMBER()`), exclui clearance/não-produto e exige `preco_por_base IS NOT NULL`.
- **`total_gasto`** exclui `is_non_product` e **inclui** `is_clearance` (gasto real). `'tudo'` = total de gasto **em produtos** (sacos/taxas fora), não a fatura bruta — reversível se preferires o total absoluto. `alvo` casa categoria **ou** produto.
- **Datas de saída** via `DATE_FORMAT(...,'%Y-%m-%d')` → strings ISO no JSON (não objetos `Date`).
- **Sem rota HTTP de consulta ainda.** As funções são uma biblioteca testável; a exposição por endpoint fica **atrás de auth** (requisito de segurança), a implementar com o OAuth.

# Análise das fontes de informação — normalização, matching e classificação (v2)

> Análise feita a 2026-06-10 com o dono, sobre dados reais de produção. Objetivo:
> mapear **todas as fontes de informação de produto** que o Bigbag tem, medir o que
> cada uma dá e o que o pipeline usa, e derivar um **plano priorizado** para melhorar
> a normalização de nomes, o matching e a classificação.
>
> **Ver também:** `Normalizacao.md` (estado atual do pipeline) · `Taxonomia_Produto.md`
> (modelo-alvo facetado — esta análise aterra várias das suas lacunas em passos concretos).

## Tese central

**As fontes que temos são mais ricas do que o pipeline usa.** O maior ganho não é
adquirir fontes novas — é **cruzar deterministicamente as que já existem**, o que
ainda por cima reduz chamadas ao LLM (menos custo, menos não-determinismo). Caso
após caso, o padrão repetiu-se: *a informação já estava na base; faltava a camada
que a liga*.

---

## 1. Inventário das fontes (números de 2026-06-10)

| Fonte | Volume | O que dá | Estado de uso |
|---|---|---|---|
| **Talão** (`item`) | 657 itens, 463 descrições distintas, 6 cadeias | nome sujo, qtd, preço, **IVA (97%)**, EAN em 28% | entrada do pipeline ✓ |
| **SKU canónico** (`sku_normalizado`) | 321 (52% c/ marca; 40 categorias texto-livre) | família genérica, unidade, formato | núcleo ✓ |
| **`sku_alias`** | 455 | cache descrição→SKU c/ confiança | ✓ funciona |
| **Fichas** (`produto_ean`) | 150 (115 OFF, 103 VLM; 95% c/ marca; 75% c/ conteúdo da embalagem em texto) | identidade real por EAN | ✓ mas conteúdo nunca é lido |
| **`produto_nome`** | 352 variantes / 144 EANs (média 2,4) | sinónimos nome↔EAN por origem | **subusado** (só worklist/carimbar) |
| **Catálogo** (`catalogo_produto`) | **46.625**: Auchan 12k + Continente 19k (**c/ EAN**) · Pingo Doce 15k + Lidl 390 (**sem EAN**) | nome PT limpo, **~3.500 marcas**, categoria_path | **só os 31k c/ EAN são usados**; PD/Lidl mortos |
| **Open Food Facts** | por EAN | nome, marca, nutrição, NOVA/Nutri-Score, categoria | ⚠ guardamos 1 string de categoria; a **DAG (`categories_tags`) é descartada** na ingestão |
| **`produto_generico`** | 288 (70 frescos c/ nutrição típica) | fresco/processado por SKU | ✓ |
| **`produto_mestre`** | 228; **249/321 SKUs ligados (78%)**; chave facetada de 10 slots (`categoria\|apresentacao\|corte\|processamento\|variedade\|sabor\|teor\|estilo\|funcao\|fonte`) | agrupamento brand-free | materializado e a funcionar |
| **`match_ean_sugestao`** | 58 (17 aprovadas, 14 rejeitadas) | **pares rotulados** talão↔catálogo validados pelo operador | usado só como fila — **material de treino desperdiçado** |
| **`nome_sugestao`** | 33 (32 aplicadas) | nomes canónicos validados | ✓ |
| Paradas | Google CSE (403) · Brave (planeado) · scrape Continente (19k/98k) | nome→EAN; catálogo completo | bloqueadas/pausadas |

Cobertura: 463 descrições → 134 batem verbatim em `produto_nome`; worklist "por
identificar" = **203 descrições sem EAN**. O buraco é o **Pingo Doce** (112 descrições,
quase zero EAN — e é a cadeia cujo catálogo não expõe EAN).

---

## 2. O talão como fonte, campo a campo

| Campo | Capturamos? | Fiabilidade / nota |
|---|---|---|
| Loja (nome/morada) | ✓ | VLM erra; mitigado (dedup 4 redes + NIF normalizado + fallback cadeia+nome) |
| NIF da loja | ✓ | normalizado a dígitos (2026-06-10) |
| **NIF do comprador** | ✗ | dado grátis → **atribuição da compra ao membro** (Sue/Gustavo têm NIFs distintos) |
| Data / nº fatura | ✓ | redes de dedup cobrem erros |
| **Forma de pagamento** | ✗ | consistente nos talões; barato; completa "Gastos" |
| **Nome do item** | ✓ | abreviado, idiossincrático por cadeia — o problema central. Caso novo: PD cola **cabeçalhos de secção** ao nome ("MERCEARIA + PET FOOD E CÁPS…") |
| Quantidade/peso | ✓ parcial | ora colada ao nome, ora ausente (frescos); tratado honesto (`peso_em_falta`); irrecuperável quando a loja não imprime |
| **IVA** | ✓ 97% | **o único campo de classificação que o talão dá** — ver §2.1 |
| Preço | ✓ | o mais protegido: reconciliação com o total + loop de re-pergunta |
| EAN (Makro) | ✓ | dígito verificador validado; pode ser "válido mas errado" (caso NAN) → cruzar c/ descrição |

### 2.1 O IVA é sinal de classificação E detetor de erros

Cruzamento IVA×categoria nos dados reais: sinal forte (Bebidas 100% a 23%; Frutas e
Legumes 90% a 6%) e **os desvios são quase todos erros detetáveis**: BANANA, CEBOLA,
TOMATE, TORANJA, RÚCULA, MIRTILO, UVA e PEITO DE FRANGO a 23% = **taxa mal lida**
(a legenda letra→taxa varia por cadeia); ameixa seca/figo seco a 23% = legítimo
(secos ≠ frescos no CIVA). Daqui saem três usos determinísticos:
1. **voto maioritário por SKU** (a banana é 6% em 13 de 14 compras → corrige a outlier);
2. **validador cruzado** IVA×categoria nos dois sentidos (taxa errada OU categoria/match errados);
3. **portão fraco no matching** (candidato de limpeza não casa com item a 6%).

Princípio geral para um leitor com ruído: **nunca confiar num campo isolado de uma
leitura isolada** — redundância entre campos (IVA×categoria, EAN×descrição) e entre
compras (voto maioritário, como o `autoCorrige` já faz para preços).

---

## 3. Achados transversais

### 3.1 Conteúdo da embalagem — mal representado (caso "IOGURTE GREGO 1 KG" Aldi)

Um EAN implica **embalagem fixa**: a quantidade do item é nº de embalagens; o
**conteúdo** (1 kg · 1 L · 18 un · 6×1L) é **propriedade do EAN**. Hoje o conteúdo
está espalhado por 4 sítios, todos com defeito: `produto_ean.quantidade` (texto
livre, "1 kg" — **nunca é lido**), `sku.formato_valor` (nível errado — partilhado
entre tamanhos: bug dos ovos 12/18), `item.linha_peso` (só pesados), nome do talão
(às vezes). Resultado medido: **36 itens (24 SKUs) com €/kg|L computável da ficha
mas ppb deixado em €/embalagem** (grego Aldi: 2,29 €/emb. vs 2,29 €/kg vs concorrente
4×125 g = 3,98 €/kg — 42% de diferença invisível). É exatamente a Taxonomia:
**formato é faceta do SKU físico (EAN)**; **unidade de comparação vem da categoria** (§4.2).

### 3.2 Marca — dois problemas diferentes consoante a cadeia

Medido nos talões: Continente imprime marcador de marca-própria em **39%** das
descrições ("CNT"), Pingo Doce **27%** ("PD"), Makro "ARO"; **Lidl/Mercadona/Aldi:
0%** — nunca imprimem marca, mas o prior é fortíssimo (Mercadona≈Hacendado;
Lidl/Aldi marca-própria por categoria). Hierarquia de evidência sem EAN:
(a) **gazetteer** de ~3.500 marcas do catálogo com match por token+IDF (substring
ingénuo dá 31% de hits mas com falsos: "Grainha" em UVA SEM GRAINHA);
(b) **tabela de marcadores** de cadeia (determinístico pré-LLM);
(c) **prior cadeia+categoria** (discounters) — inferida com confiança;
(d) **match com o catálogo da mesma cadeia** (marca de borla);
(e) **pares aprendidos** em `produto_nome`;
(f) resto → "marca desconhecida" como valor válido e isolado (regra do Mestre).
Precisa de um campo **`marca_origem`** (impressa|marcador|catálogo|prior|llm|ean) —
sem ele, marca lida e adivinhada são indistinguíveis, e a UI não pode ser honesta.

### 3.3 Sabor e facetas discriminantes — tratado em 3 sítios, de 3 maneiras

- Chave do Mestre: **slot próprio** ✓ (modelo certo);
- `resolverProduto` (nome→EAN): gate duro `saborConflito` ✓ mas lista hardcoded,
  só PT, **mistura sabor com teor/dieta**;
- `matcher.resolverSku` (talão→SKU): **nenhum tratamento** — o Dice trata "morango"
  como token qualquer. Casos medidos: "Iogurte Grego Natural **Magro**" vs "…Natural"
  → Dice 0,857 ≥ 0,85 → **auto-match errado**; "…com Caramelo" vs "…com Avelãs" →
  0,67 → fica nas mãos do juiz LLM quando é decidível por regra.
Falta **um vocabulário único** de facetas discriminantes (sabor ≠ teor ≠ dieta),
multilingue (fresa/strawberry/morango — o catálogo e OFF vêm em ES/EN/FR), partilhado
pelos 3 sítios, com **política do ausente** (§11.3: omisso ≠ "natural" ≠ wildcard).

### 3.4 Nome abreviado → nome real: o "motor de busca interno" (validado)

Experiência real (`scripts/demo_busca_catalogo.mjs`): tokens + **prefixo**
(BOL→Bolachas, LIG→Ligeiro) + **IDF** (raridade) sobre o catálogo:
- "IOG MYTHOS CNT EQ NAT LIG" → **Iogurte Grego Mythos Ligeiro Natural Continente
  Equilíbrio (0,89, com EAN)** — o worked example da Taxonomia, resolvido sem LLM;
- "BOL DIGESTIVE AVEIA CNT 425GR" → família certa (0,83, EAN; o produto exato falta
  porque o scrape do Continente parou a 19k/98k);
- Falhas instrutivas: "QJ" não é prefixo de "queijo" (**abreviatura por consoantes →
  precisa do dicionário aprendido** — peças complementares); "**com/sem** côdea"
  empatou porque "sem" era stopword (**com/sem é negação que define o produto — nunca
  stopword**); o formato (425GR) deve ser desempate.

### 3.5 Dados de treino que já temos (e desperdiçamos)

Pares (descrição de talão ↔ nome limpo/marca/EAN) já **validados**: `produto_nome`
(352), aprovações/rejeições da aba EANs (31), `sku_alias` (455), `nome_sugestao`
aplicadas (32). Dá para **minar** um dicionário de abreviaturas por cadeia
(QJ→Queijo, M/G→Meio-Gordo, BRAS→Braseado…) e expansões — hoje isso vive só no
prompt do LLM, que é não-determinístico. Cresce com o uso (cada scan/aprovação
acrescenta pares).

---

## 4. Plano consolidado (prioridades)

### Fase A — determinístico, baixo custo, alto valor

| # | Proposta | Notas |
|---|---|---|
| A1 | **Conteúdo da embalagem estruturado** na ficha (`conteudo_valor/unidade/pack` parseados de `quantidade` c/ `extrairFormato`) + **cadeia do ppb**: linha_peso → conteúdo-da-ficha-via-EAN → formato do SKU → peso_em_falta | recupera 36 itens já; mata ovos 12/18; afeta comparações **já visíveis** (lista, melhor preço) |
| A2 | **Motor de busca interno** no catálogo p/ canonicalização (prefixo + IDF + formato-desempate + prior da mesma cadeia + com/sem) — generalizar o `resolverProduto` p/ devolver **nome/marca/categoria mesmo sem EAN** | validado em demo; desbloqueia os 15,5k nomes PD/Lidl mortos |
| A3 | **Dicionário de abreviaturas minado** dos pares validados (produto_nome + aprovações + aliases), aplicado **antes** do LLM | complementa A2 (consoantes: QJ, FF); menos LLM, menos variantes |
| A4 | **Marca determinística pré-LLM**: tabela de marcadores (CNT/PD/ARO/Mythos…) + gazetteer c/ IDF + campo **`marca_origem`** | §3.2 (a)+(b); o campo destrava o resto |
| A5 | **IVA**: voto maioritário por SKU + validador IVA×categoria (check no `diagnostico_bd` + correção) | limpa distorções existentes e vigia futuras |
| A6 | **Vocabulário único de facetas discriminantes** (sabor/teor/dieta/com-sem, multilingue) + **gate de conflito no `resolverSku`** + política do ausente | mata auto-merges errados; menos juiz LLM |
| A7 | **Persistir `categories_tags`/`food_groups` do OFF** no off_json | 1 linha agora, evita backfill impossível depois |

### Fase B — médio custo

| # | Proposta | Notas |
|---|---|---|
| B1 | **Categoria com vocabulário fechado** no SKU (enum ~12 grupos + subnível) + mapas determinísticos categoria_path/OFF→enum + LLM restringido + backfill dos 40 valores | move o `categoriaAlto` do frontend p/ a base; "categoria limpa por SKU" do backlog |
| B2 | **Consulta por IDF/tokens** em vez de `LIKE '%termo%'` (`queries.js`) | precisão da voz; motor de A2 reutilizado |
| B3 | **Terminar o scrape do Continente** (19k/98k) + **sondar API da Mercadona** | cobertura de A2/A4; Mercadona é a cadeia 0%-marca sem catálogo |
| B4 | **Prior de marca-própria** cadeia+categoria via catálogo | §3.2 (c); depende de B3 p/ Mercadona |
| B5 | Capturar **NIF do comprador** (→ membro) e **forma de pagamento**; **filtro de cabeçalhos de secção** (PD) na extração | campos baratos no schema do VLM |

### Fase C — quando A+B estiverem medidas

| # | Proposta | Notas |
|---|---|---|
| C1 | Busca web EAN→nome p/ **não-alimentares** (Brave/CSE — desbloquear a chave) | backlog existente |
| C2 | **Embeddings** p/ matching/consulta | só se o IDF+facetas (A2/A6/B2) deixar resíduo que o justifique |
| C3 | Formato por item (`item.formato_valor`) p/ casos sem EAN | A1 resolve a maioria via ficha |

### Princípios (transversais ao plano)

1. **Determinístico primeiro; LLM só onde só ele serve** — todas as propostas A reduzem chamadas.
2. **Camadas partilhadas, não cópias** — um vocabulário de facetas, um gazetteer de marcas, um motor de matching; hoje cada módulo tem o seu e divergem.
3. **Confiança explícita em tudo o que é inferido** (`marca_origem`, confiança do match) — a UI diz o que leu vs o que adivinhou.
4. **Redundância contra o ruído do VLM**: entre campos (IVA×categoria, EAN×descrição) e entre compras (voto maioritário).
5. **O conhecimento cresce com o uso**: cada scan/aprovação alimenta `produto_nome`/dicionários — os ciclos virtuosos já existentes estendem-se às novas camadas.

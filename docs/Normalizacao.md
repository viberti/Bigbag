# Bigbag — Normalização de produto (análise de engenharia)

> Documento técnico para análise. Descreve o **problema** da normalização, as
> **dificuldades** reais encontradas, a **solução** adotada e os **problemas em
> aberto**. Sem segredos, credenciais nem dados de utilizador.
> Última atualização: 2026-06-08.
>
> **Ver também:** [`Taxonomia_Produto.md`](Taxonomia_Produto.md) — o **modelo-alvo**
> facetado (standards OFF/GS1/IFPS, níveis e coortes), com o iogurte grego como
> template. Este documento é o **estado atual**; esse é **para onde deve ir**.

## 1. O problema

O valor do Bigbag é comparar **o mesmo produto** ao longo do tempo e entre lojas
("onde está mais barato o leite?", "a banana subiu?"). Para isso, duas coisas têm
de ser resolvidas a partir de uma linha de talão:

1. **Identidade canónica** — reconhecer que `BOL DIGESTIVE AVEIA CNT 425GR` (Continente),
   `DIGESTIVE AVEIA` (Lidl) e `Bolacha Digestive` são **o mesmo produto**.
2. **Preço comparável** — `preco_por_base` em €/kg, €/L ou €/un, para que formatos
   diferentes (250 g vs 1 kg, pack de 6 vs 1 unidade) comparem na mesma escala.

A entrada é **hostil**: descrições abreviadas e inconsistentes, erros de OCR/VLM,
convenções diferentes por cadeia (posição do código de IVA, separador de multipack,
peso impresso ou não), marcas que aparecem ou não, e acentuação variável. Não há
EAN/código de barras nas linhas. É, na prática, um problema de *entity resolution*
sobre texto sujo — a parte mais difícil do sistema.

### 1.1 Os três níveis de NOME (decisão de design, 2026-06-08)

O mesmo produto físico tem **três nomes diferentes**, cada um com o seu papel — e
**confundi-los** é a raiz de boa parte da dívida de normalização. São níveis, não
sinónimos:

1. **Nome da nota** — `item.descricao_original`: a abreviatura do talão
   (`KETCH 500ML`, `IOG MYTHOS CNT EQ NAT LIG`). É o que se leu; varia por cadeia,
   é ruidoso. Serve de **entrada** da resolução, não de identidade.
2. **Nome do produto real** — a identificação **por EAN** (`produto_ean`), **com
   marca e tamanho** (ex.: *Ketchup* da **Heinz**, 500 g). É a identidade física
   exata. A **marca mostra-se ao NÍVEL DO ITEM** na app (o item comprado é de uma
   marca concreta), não no nome canónico.
3. **Nome normalizado** — `sku_normalizado.nome_canonico`: a **família genérica**,
   **partilhada por várias marcas e lojas** (ex.: *Ketchup*, *Iogurte Grego
   Natural*, *Queijo Grana Padano*). É o que agrupa para **comparar preços entre
   marcas**.

**Decisão: a marca NÃO entra no nome normalizado.** Pô-la lá *estraga* o nível 3 —
o nome canónico é partilhado, e cravar "Heinz" partia o "Ketchup" em tantos SKUs
quantas as marcas. A marca vive no **nível do produto real** (nível 2, por EAN) e no
item. O que o nome normalizado **mantém** é a **variedade / tipo que DEFINE a
família** (*Grego*, *Ligeiro*, *Grana Padano*, *Curado*…) — isso não é marca, é o
que distingue uma família da outra. Este modelo de 3 níveis alinha com o modelo
facetado-alvo (ver `Taxonomia_Produto.md` §4): o nome normalizado ≈ o **Produto
Mestre** genérico; marca/tamanho/EAN são **facetas do específico**.

## 2. Modelo de dados

```
item.descricao_original ──(resolução)──► sku_normalizado ◄──(cache)── sku_alias
                                              ▲
                          preco_por_base, taxa_iva (no item)
```

- **`sku_normalizado`** — o **produto canónico**:
  - `nome_canonico` — **sem marca e sem formato** ("a classe": é o que agrupa).
  - `marca`, `categoria`.
  - `unidade_base` (`un`/`kg`/`L`) — **autoritativa**: a unidade em que o produto
    compara (decisão de design "Fase 1"). Todos os itens do mesmo SKU usam-na.
  - `formato_valor` — formato fixo quando aplicável (ex.: 0,425 kg para um pacote
    de 425 g); `NULL` para peso variável (€/kg de balcão).
  - `nome_simplificado` — agrupamento grosseiro opcional (operador).
- **`sku_alias`** — cache `descricao_original → sku_id` (com `origem`: `llm`/`manual`).
  As descrições repetem-se muito; o alias evita re-canonicalizar. **A chave é a
  descrição LIMPA** (sem qtd/peso/preço/IVA) — senão o peso variável por compra
  fazia a mesma banana nunca reusar o alias (ver §4.1).
- **`item`** — guarda `descricao_original` (nome **limpo**; o ruído estrutural vai
  fora), `linha_peso` (peso de balcão, à parte do nome), `preco_por_base`
  (comparável; **sempre com IVA**), `taxa_iva`, **`peso_em_falta`** (produto a
  peso/volume sem peso na nota → `ppb=NULL` honesto, marcado p/ sair do €/kg), e
  **`ean`** (migração **027**) — EAN-13 do artigo quando o talão o imprime
  (cash-and-carry como o Makro, coluna "Nº Código Artigo"). **Validado pelo dígito
  verificador** antes de gravar; identifica o produto real (nível 2) **sem foto** e
  é enriquecido pelo OFF na ingestão.

**Tabelas de apoio aos 3 níveis de nome (§1.1) e à caracterização:**
- **`produto_nome`** (migração **024**) — guarda **todas as variantes de nome**
  vistas para um produto (chaveado por EAN): `origem` ∈ {`talao`, `canonico`, `vlm`,
  `off`}. Dedup por `(ean, nome)`. Alimenta o *matching* de descrições e serve de
  matéria-prima para **afinar o nome canónico**. Preenchida na identificação por
  EAN (`guardarNomes` em `routes/produto.js`) e por `scripts/backfill_nomes.mjs`.
- **`nome_sugestao`** (migração **025**) — fila de sugestões de nome canónico
  geradas por LLM (`sugerirNomeCanonico`) a partir das variantes; o operador
  **aplica/rejeita** na aba "Nomes" do `/admin`. Estado ∈ {`pendente`, `aplicado`,
  `rejeitado`}; `scripts/sugerir_nomes.mjs` gera em lote.
- **`produto_generico`** (migração **023**) — classificação por **SKU**: `tipo`
  (`fresco`/`processado`) + `nutricao` típica por 100 g **só para os frescos**
  (a dos embalados vem do rótulo/OFF, não se inventa). Preenchida por
  `caracterizarProdutoNome` (LLM) / `scripts/enriquecer_genericos.mjs`. Distingue,
  por SKU, o que precisa de foto/EAN do que já se conhece pela tabela de composição.

## 3. O pipeline (3 camadas + pós-processos)

### Camada 1 — Formato → `preco_por_base` (`formato.js`, determinística)
Faz parsing do formato/peso/contagem na descrição e calcula o €/base. Padrões, do
mais específico ao mais geral:
1. peso + €/kg impresso: `0,540 kg x 6,19 EUR/kg`;
2. peso sem unidades: `1,170 X 1,29`;
3. **€/kg ou €/L impresso em qualquer ordem** (apanha leituras mal formadas);
4. multipack `4X115G`, `6*1L`, `3*200ML` (aceita `x`, `×`, `*`);
5. formato simples `425GR`, `1,5L`, `2K`;
6. unidades/contagem: `16UN`, dúzias, ovos.

`precoPorBase(item, formato, unidadeAlvo)`: usa a **unidade autoritativa do SKU**.
Se o alvo é peso/volume mas a descrição não traz peso → devolve **`null`**
(incomputável honesto), em vez de um €/embalagem enganador.

**Peso estruturado na extração (2026-06-07):** o VLM passou a devolver `peso_kg` e
`preco_base_impresso` (€/kg) em **campos próprios** do JSON, em vez de colar o peso
no nome. `normalizarItens` reconstrói o `linha_peso` canónico desses campos — o nome
fica limpo na origem e o €/kg vem direto do talão (sem regex). Os caminhos regex
mantêm-se como rede de segurança (PDF-texto / retrocompatibilidade).

**Derivação por pacote fixo (`ppb.js`, `pacoteFixoFiavel`):** quando o produto é a
peso mas a linha não traz peso E o SKU é um **pacote fixo fiável** (`formato_valor`
real ≠1, **nunca** pesado ao balcão, sem marcador `KG`/`GRANEL` nem multipack na
descrição), deriva-se `€/base = preço / tamanho do pacote`. Recupera packs de peso
fixo (ex.: mirtilo 500 g → 10,30 €/kg) **sem** fabricar €/kg para itens pesados ao
balcão (banana, carne — esses ficam `peso_em_falta`).

### Camada 2 — Canonicalização por LLM (`canonical.js`)
Texto-only (barato). Devolve `{ nome_canonico (sem marca/formato), marca,
categoria, unidade_base, confianca }`. Guarda-corpos no prompt:
- **unidade_base por regra** (peso→kg, líquido→L, contado→un; na dúvida sólido a
  peso → kg);
- expande abreviaturas (`BOL`→Bolacha, `QJ`→Queijo, `M/G`→Meio-Gordo…);
- marcadores de cadeia (`CNT`, `PD`…) vão para `marca`, não para o nome;
- **corrige OCR óbvio** com conhecimento de produto (`OLO GIRASSOL`→Óleo de Girassol),
  mas **nunca inventa**: ilegível → confiança baixa; só números → `(desconhecido)`.

### Camada 3 — Resolução/Match (`matcher.js` → `resolverSku`)
Cascata determinística com **um** passo LLM opcional:
1. **alias exato** (cache) → instantâneo;
2. **canonicalizar** (Camada 2, com contexto da cadeia);
3. **candidatos** = SKUs com **a mesma marca + a mesma unidade** + formato compatível;
4. **similaridade** de nome = **Dice sobre tokens normalizados** (acentos/maiúsculas
   fora, stopwords removidas) + reforço de subconjunto;
5. **limiares**: ≥ 0,85 → match automático; 0,6–0,85 → **juiz LLM** confirma;
   < 0,6 → cria SKU novo. **Nome canónico idêntico** (normalizado) reutiliza sempre
   o SKU (mesma marca/unidade);
6. grava o **alias** para a próxima vez.

### Pós-processos
- **Auto-fusão** (`mergeNomesIdenticos`): funde SKUs com `nome_canonico`
  **normalizado idêntico** (acentos/maiúsculas fora) num só — mantém o mais usado,
  move itens e aliases. Corre na ingestão (filtrada aos nomes da nota) e no
  reprocesso; e global a partir do `/admin`.
- **Recompute** (`ppb.js`): recalcula `preco_por_base` respeitando a unidade
  autoritativa; **converte grossista (sem IVA) para o preço final** (× (1+taxa)),
  para Makro comparar com supermercados; **não sobrescreve** valores inferidos.
- **Auto-correção de outliers** (`autoCorrige.js`): se o `ppb` está ≫ a mediana do
  SKU e dividir por um pack plausível (÷6, ÷12…) o traz à faixa, corrige e marca
  `ppb_inferido` (reversível). Apanha packs não capturados (ovos à dúzia, leite 6×1L).
- **IVA por produto**: `taxa_iva` (lida do código + legenda do talão) +
  `fatura.precos_com_iva` (grossista distingue-se por aritmética, robusto a erro do LLM).

A correspondência **produto em linguagem natural → SKU** no tempo de **consulta** é
mais simples (`queries.js`): `LIKE` sobre nome/marca/categoria/descrição + fallback
fuzzy ao nível do caractere (Levenshtein) quando o LIKE não acha nada.

## 4. Dificuldades encontradas (casos reais)

A normalização foi endurecida caso a caso, ao **ver os dados**. As dificuldades
agrupam-se em três famílias:

### 4.1 Formato / preço por base (Camada 1)
- **Separador de multipack varia**: o Continente usa `6*1L`, não `6x1L`. O parser
  só aceitava `x`/`×` → ignorava o "6×" e dividia pelo formato errado (leite a
  **5,16 €/L** em vez de 0,86). Afetava todos os multipacks da cadeia.
- **Ordem do peso/€/kg**: leituras mal formadas do Lidl (`BANANA B kg x1,056 1,19
  EUR/kgEUR`) traziam o €/kg mas com o `kg` antes do número → o parser falhava.
- **Contagem depois do tamanho** (grossista): Makro `1LT 6` = caixa de 6×1L, com
  `quantidade=1`. Auto-parsear isto colide com itens tipo `350G 2` (onde a contagem
  já está no `quantidade`) → dupla contagem. Não há regra segura genérica.
- **Peso simplesmente ausente**: o talão **simplificado do Continente NÃO imprime
  o peso** de produtos a granel (`(A) BANANA 2,07`) — só o total. O €/kg é
  **estruturalmente irrecuperável** dessa fonte → hoje fica `peso_em_falta` (§5).
- **Pré-embalados sem peso**: `QUEIJO GOUDA 3,85` (Lidl) — queijo a peso vendido por
  embalagem, sem peso impresso → €/kg desconhecido (`peso_em_falta`).
- **Ruído no nome capturado** (resolvido): a descrição trazia qtd/peso/preço/IVA
  colados (`1 BANANA 2,880 kg`, `BANANA B kg x1,056 1,19 EUR/kgEUR`, `(A) IOG…`).
  Além de feio, **quebrava o cache de aliases** — o peso varia a cada compra, logo
  a mesma banana nunca reusava o alias e re-corria fuzzy/LLM. **Solução:**
  `limparDescricao` corre como passo final em `normalizarItens` (preserva o peso em
  `linha_peso` antes de o tirar) e a **chave do alias é a descrição limpa**. A nova
  extração estruturada já entrega o nome limpo na origem.

### 4.2 Unidade autoritativa errada (Camada 2) — **resolvido**
- A canonicalização **adivinhava mal a unidade**: classificou `DIOSPIRO MOLE 350 G`
  como `un` (fruta = "contado") apesar do peso explícito → €/un em vez de €/kg.
  A regra "peso → kg" perdia para o palpite "fruta = unidade" do LLM.
- **Correção (determinística-primeiro):** quando o formato traz **peso/volume
  explícito** (g/kg/ml/cl/L, incl. multipack `4X125G` = 500 g), o formato **ganha**
  ao LLM (`decidirUnidadeBase`). Volume → sempre L. Exceção: **categorias contadas**
  (ovos — onde `53-63G` é o calibre, não o pacote; sabonete) ficam `un`. Testado em
  `test/unidade.test.mjs`. Sem peso/volume no formato, mantém-se a unidade do LLM.

### 4.3 Identidade / duplicados (Camadas 2-3 + fusão)
- **Fragmentação por marca**: o `matcher` filtra candidatos por **mesma marca**
  (filtro duro). Mas o `nome_canonico` é *brand-agnostic* por design. Resultado:
  "Maçã Gala" (sem marca) e "Maçã Gala" (marca Nacional) tornam-se **SKUs separados**
  — o mesmo produto, dois registos. Há uma tensão de design: a Camada 3 fragmenta
  por marca; a auto-fusão (por nome) consolida. Em regime estável dependem uma da outra.
- **Variantes de acento/grafia**: "Maca Gala" vs "Maçã Gala" (sem til/cedilha de OCR).
  Mitigado: `normalizarNome` tira acentos, logo a fusão junta-os.
- **Não-determinismo do LLM**: a Camada 2 pode devolver nomes/marcas ligeiramente
  diferentes para a mesma descrição em momentos diferentes → cria duplicados.
- **Reprocesso sem fusão (regressão)**: um reprocesso em lote re-canonicalizou todas
  as notas mas **não chamava a auto-fusão** (só a ingestão chamava) → criou **38
  grupos duplicados (50 SKUs)** de uma vez ("Maçã Gala", "Ovos", "Rúcula"…). Corrigido.
- **Match na consulta por substring**: `LIKE '%leite%'` apanha "Doce de Leite" e
  "Leite Achocolatado" ao perguntar por "leite". Valores certos por item, mas
  **produtos misturados**.
- **Faturas duplicadas por nome/data mal lidos** (resolvido): o VLM leu o Mercadona
  como "Irmadona" e errou a data → a mesma compra entrou **duas vezes** (a dedup
  antiga era por `loja_id`+data+total). **Solução:** dedup robusta em `persist.js` —
  `cadeia + total + nº de itens`, confirmada por **sobreposição de preços**
  (`sobreposicaoPrecos`, tolera ±0,02 de OCR). Forte porque, com itens a peso, dois
  trajetos reais quase nunca dão o total exatamente igual.

### 4.4 IVA (transversal ao preço comparável)
- O **grossista (Makro) imprime preços SEM IVA**, somado no fim; supermercados com
  IVA. Comparar €/kg dos dois é enganador. E o código de IVA por linha **varia por
  cadeia** e o **mesmo símbolo significa taxas diferentes** ("A"=6% no Continente,
  23% no Lidl) → tem de ser resolvido pela legenda de cada talão.

## 5. Soluções adotadas

- **Camada determinística onde dá** (formato, similaridade, fusão, auto-correção):
  testável, sem custo de LLM, sem não-determinismo. O LLM só faz o que só ele faz
  bem (interpretar texto livre, desambiguar).
- **Alias-cache**: a esmagadora maioria das linhas resolve-se instantânea e
  deterministicamente; o LLM só corre para descrições novas.
- **Unidade autoritativa por SKU** + **recompute**: garante base comum; o operador
  corrige a unidade no `/admin` e recalcula todas as compras do produto.
- **Unidade determinística-primeiro** (`decidirUnidadeBase`): o peso/volume explícito
  do formato ganha ao palpite do LLM (com exceção de categorias contadas) — ver 4.2.
- **Confiança do mapeamento por via** (`sku_alias.confianca`, 0–100: manual/fusão 100,
  match 90, juiz 75, SKU novo 60): guardada **no alias** (durável, sobrevive a
  reprocessos). Alimenta a **aba Revisão** do `/admin` — worklist do pior para o melhor
  (itens sem SKU + mapeamentos de baixa confiança), tornando a curadoria dirigida por
  dados em vez de caça aleatória. Limpeza de SKUs órfãos (0 itens, sem alias manual)
  corre no fim de cada reprocesso.
- **Sinais honestos, não números forçados**: `preco_por_base = null` + **`peso_em_falta`**
  quando o produto é a peso mas a nota não traz peso (em vez de assumir 1 kg ou um
  €/peça enganador); `(desconhecido)` quando a descrição não tem produto;
  `needs_review` quando a reconciliação não bate.
- **Nome limpo na origem + chave de alias limpa**: `limparDescricao` tira qtd/peso/
  preço/IVA do nome (preservando o peso em `linha_peso`); o alias passa a reusar. A
  extração estruturada (`peso_kg`) entrega o nome já limpo.
- **Derivação de €/kg por pacote fixo** (`pacoteFixoFiavel`): para packs de peso fixo
  sem peso na linha (mirtilo 500 g), deriva do tamanho do pacote — nunca para itens
  pesados ao balcão (evita €/kg fabricado).
- **Dedup robusta a leituras erradas**: `cadeia + total + nº de itens` + sobreposição
  de preços — apanha duplicados mesmo com nome de loja ou data mal lidos.
- **Peça cortada a peso → kg**: `decidirUnidadeBase` força kg para "partido/partida/
  metade/granel" (mamão partido), para o €/kg ficar `null` honesto em vez de €/peça.
- **Auto-fusão por nome normalizado** (acentos fora) na ingestão **e no reprocesso**
  (corrigido), + fusão global no `/admin`.
- **Auto-correção de outliers** por mediana do SKU (≥3×) com divisão por pack
  plausível, marcada como inferida e reversível.
- **IVA por produto**: a extração lê o código + a legenda do talão e devolve a
  **taxa por item**; um **guarda aritmético** decide se o IVA é somado (grossista)
  comparando a reconciliação com e sem IVA — robusto a o LLM ler a tabela
  informativa como IVA-somado. `preco_por_base` fica **sempre com IVA**.
- **Nome canónico afinado pelas variantes** (3 níveis, §1.1): o LLM
  (`sugerirNomeCanonico`) propõe o **melhor nome GENÉRICO** (PT, **sem marca**, com
  o tipo/variedade que define a família) a partir de todas as variantes de
  `produto_nome`; o operador aplica/rejeita na **aba "Nomes"** do `/admin`. A
  aplicação tem **guarda anti-colisão** (recusa se o nome sugerido já existir noutro
  SKU — não duplica). A geração ignora SKUs já rejeitados.
- **EAN da linha do talão como identidade forte** (migração 027): quando a cadeia
  imprime o EAN na linha (Makro), `item.ean` identifica o **produto real** (nível 2)
  sem foto e é enriquecido pelo OFF na ingestão (`enriquecerEansFatura`).
- **Validação de EAN pelo dígito verificador** (`eanValido`, GTIN-8/12/13/14): todo
  o EAN — lido da linha, do scanner, do VLM ou da foto — passa pela soma de
  controlo antes de gravar. Apanha leituras erradas (1.º dígito 4→2…) **sem
  internet** e evita produtos-fantasma. EAN que falha a soma é rejeitado e
  assinalado (`ean_rejeitado`).
- **Limpeza de marca** (`limparMarca`, frontend): o OFF lista várias marcas por
  vírgula, incluindo a **holding** (`Continente, Continente Seleção, SONAE`). Tira a
  holding (lista `MARCAS_HOLDING`) e fica com a **1.ª marca real** — para a marca
  mostrada ao nível do item ser a do fabricante, não o grupo.
- **Caracterização fresco/processado por SKU** (`produto_generico`): o LLM
  classifica o produto pelo **nome** (fresco vs. embalado) e, para os frescos, dá a
  **nutrição típica** por 100 g (das tabelas de composição) — dispensa foto/EAN para
  a parte conhecida; os embalados ficam com nutrição a `NULL` (vem do rótulo).
- **Operador no ciclo** (`/admin`): renomear, associar/dissociar descrições (alias
  `manual`, confiança máxima), fundir, definir unidade, editar quantidade/peso,
  ver outliers de preço, e **aprovar nomes canónicos** (aba "Nomes"). A correção
  humana alimenta a cache de imediato.

### 5.1 Identificação por EAN — worklist "por identificar" (2026-06-09)
Para a worklist de produtos a identificar (embalados sem EAN, não-frescos), um item
**sai da lista** quando: (a) tem `item.ean`; (b) a mesma descrição+cadeia já tem ficha
por EAN **ou** por foto/VLM/OFF (captura só-fotos também resolve); ou (c) **reuso entre
cadeias pelo MESMO EAN** — a descrição do talão está ligada a **um único EAN** em
`produto_nome` (nome↔EAN). É o critério do *mesmo EAN*, **não** de marca/SKU: "CARLSBERG
LATA" e "...TP" têm EANs distintos (cada um resolve o seu); nomes genéricos ligados a
**vários** EANs (LEITE MEIO GORDO, IOGURTE GREGO = marca-própria diferente por loja)
ficam na lista (ambíguos). Foram **descartadas** duas heurísticas frouxas (só-SKU;
marca-no-nome) que escondiam produtos diferentes.
- **Carimbar EAN** (`scripts/carimbar_ean.mjs`, idempotente): grava `item.ean` nas linhas
  sem EAN cujo nome liga a um EAN único em `produto_nome` (nome idêntico → mesmo produto).
- **Merge de SKU** (`/skus/merge`) passou a preservar `sku_alias`+`produto_nome`+
  `produto_ean`+genérico — os nomes de talão ficam ligados ao SKU que fica, matching futuro intacto.
- **EAN à mão** na **aba Itens** do `/admin`: define/limpa `item.ean` (valida dígito
  verificador + enriquece a ficha por OFF/catálogo).

## 6. Problemas em aberto

1. ~~**Unidade adivinhada errada**~~ **resolvido** (ver 4.2): peso/volume explícito
   no formato força kg/L (`decidirUnidadeBase`), com exceção das categorias contadas.
   O iogurte `4×125 g` **não** era ambíguo — é 500 g → €/kg (o parser já multiplica).
   Resíduo: a lista de "categorias contadas" é uma heurística curta de palavras-chave
   (ovos, sabonete); itens contados raros com peso impresso podem precisar de a estender.
2. **Fragmentação por marca** vs `nome_canonico` brand-agnostic: a tensão entre o
   filtro-duro-de-marca (Camada 3) e a fusão-por-nome obriga à auto-fusão como
   muleta. Repensar se a marca deve ser filtro duro (talvez só para embalados, não
   para produto a granel/fruta).
3. **Quase-duplicados** (nomes parecidos mas **não** idênticos): "Maçã Gala" vs
   "Maçã Royal Gala", "Iogurte Grego" vs "Iogurte Grego Natural". A auto-fusão (nome
   idêntico) não os apanha — e fundir por similaridade automaticamente arrisca juntar
   produtos diferentes. Fica para fusão **manual** no `/admin`.
4. **Match na consulta por substring** (`LIKE '%termo%'`): impreciso (mistura
   produtos). O passo seguinte seria **embeddings** sobre `nome_canonico`, ou casar
   pelo SKU em vez de pelo nome.
5. **€/kg irrecuperável na origem** (mitigado): lojas que não imprimem €/kg
   (Mercadona/Aldi a granel) e pré-embalados a peso sem peso impresso. Investigação
   (2026-06-07): re-ler as notas recuperou **só 1 item** — o resto é mesmo ausência
   na fonte (causa 1), não perda de extração. Hoje: itens a peso sem peso → `null` +
   **`peso_em_falta`** (fora do €/kg, honesto); packs de peso fixo recuperados por
   `pacoteFixoFiavel`. Resíduo: peças variáveis (mamão partido) ficam sem €/kg — o
   operador pode escrever o peso à mão. Enriquecer pela web: rejeitado (preço atual ≠
   histórico, matching frágil, ToS).
6. **Não-determinismo do LLM na canonicalização**: ainda pode introduzir variantes;
   a auto-fusão e a cache amortecem, mas não eliminam.
7. **Dependência da qualidade da leitura (a montante)**: a normalização só é tão boa
   quanto a extração; muitos €/kg estranhos vêm de erros de formato/quantidade na
   leitura, não da normalização em si.

### ⚠️ Calibração
As observações vêm de uma amostra **pequena e benigna** (utilizador único, fotos
cuidadas, quase só Continente/Lidl/Pingo Doce, sobretudo PDFs). Num cenário público
(volume, fotos descuidadas, muitas cadeias) vários destes problemas agravam-se.
**Re-medir com dados reais antes de fechar qualquer decisão.**

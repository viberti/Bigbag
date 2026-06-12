# Como o BigBag classifica produtos de supermercado

*Documento didático (≈3 páginas) para apresentação em turma de graduação.
Derivado de `Taxonomia_Produto.md`, `Normalizacao.md`, `Conceito §11` e `Analise_Fontes §Fase D` — snapshot de 2026-06-14; não é fonte de verdade.*

---

## 1. O problema

O BigBag lê **notas fiscais de supermercado** (foto ou PDF) e responde a perguntas como
*"onde o leite está mais barato?"* ou *"esse iogurte é bom para o perfil da Sue?"*.
Para isso, precisa saber **que produto é cada linha do talão**. Só que o talão não ajuda:

```
LEIT MG UHT PD200ML          ← que produto é isso?
BOL DIGESTIVE AVEIA CNT 425GR
IOG GREGO LIGEIRO PD 4X120
PREPARADO CARNE PICADA PORC
```

O mesmo produto aparece **escrito diferente em cada loja e em cada data**. Sem
classificação, não há comparação de preços (estaríamos comparando strings, não
produtos) nem aconselhamento de saúde (não sabemos a nutrição de `"LEIT MG UHT"`).

**Duas armadilhas clássicas** que encontramos com dados reais:
- Comparar preço por embalagem engana: um pack de 9 mini-garrafas de 200 ml dava
  "leite a 0,31 €" — por isso toda comparação usa **preço por unidade base** (€/L, €/kg, €/un).
- Texto engana: `"sal"` casava com `"SALmão"` por prefixo; a categoria de loja
  "Charcutaria e **Queijos**" mandava queijos para o grupo *carne*.

---

## 2. A identidade tem três níveis (não um)

A mesma compra tem **três nomes**, e os três importam:

```
 NÍVEL 1 · NOTA              NÍVEL 2 · PRODUTO REAL          NÍVEL 3 · FAMÍLIA (SKU)
 o que o talão diz           o que foi comprado              o conceito comparável
┌──────────────────────┐    ┌─────────────────────────┐    ┌──────────────────────────┐
│ "IOG GREGO LIGEIRO   │ →  │ Iogurte Grego Ligeiro   │ →  │ Iogurte Grego Natural    │
│  PD 4X120"           │    │ Pingo Doce · 4×120 g    │    │ Ligeiro                  │
│ (abreviado, c/ erros)│    │ EAN 5601234…  (âncora!) │    │ (sem marca, sem tamanho) │
└──────────────────────┘    └─────────────────────────┘    └──────────────────────────┘
       item                       produto_ean                   sku_normalizado
```

- O **EAN** (código de barras) é a identidade forte: liga ao Open Food Facts
  (nutrição, ingredientes, Nutri-Score) e desambigua marcas. É validado pelo
  dígito verificador antes de entrar na base.
- A ficha do nível 2 não é "a primeira fonte que respondeu": é uma **FUSÃO
  campo-a-campo de todas as fontes** (catálogos de loja, OFF, leitura do rótulo),
  com uma **tabela de prioridades num só lugar** e prioridades *diferentes por
  campo* — a marca confia no catálogo (o OFF crowdsourced chama "Hacendado" a
  produtos de terceiros), a nutrição confia na tabela oficial da loja, os
  ingredientes vencem por **completude medida** (com penalização de lixo-OCR e
  de língua estrangeira), e a correção manual do operador é sagrada. Cada campo
  guarda a **proveniência** e as divergências entre fontes ficam registadas.
  A fusão é **idempotente** (re-correr não muda nada) — propriedade que se TESTA.
- **Frescos** (banana, carne picada) não têm EAN útil → a identidade é o **nome**,
  e a nutrição vem da **classe** ("banana" tem nutrição conhecida por 100 g).
- **É aqui que a tensão preço-vs-nutrição se resolve** (Família → Produto → EAN):
  o **preço** compara-se no nível 3 (família, *sem* marca — senão não havia "onde
  está mais barato"); a **nutrição** vem do nível 2 (EAN, *com* marca — a receita
  muda os números). São identidades diferentes **de propósito**, não confusão.

### Nutrição: da CLASSE ou do PRODUTO (e o EAN não decide)

Erro comum (que tínhamos no 1.º modelo): "fresco → classe; embalado → EAN". A
fronteira **não é a embalagem nem o EAN** — é a **natureza do alimento**:

| | Fonte da nutrição | Exemplos |
|---|---|---|
| **Da CLASSE** (por nome) | a nutrição é uma propriedade do *tipo* de alimento | frescos (banana), **cereais/staples** (arroz, farinha, massa), **pão** |
| **Do PRODUTO** (por EAN→OFF) | a *receita/marca* muda a nutrição | bolacha Oreo ≠ bolacha genérica; cereais de pequeno-almoço de marca |
| **Irrelevante** | — | álcool, não-alimentar (lixívia) |

Os dois enganos que isto desfaz:
1. **Um fresco pode ter EAN** (ovos em caixa, salada em saco, pão industrial) —
   **mesmo assim herda pela classe**. O EAN serve a identidade e o preço, não muda
   a nutrição de "ovo".
2. **Um item de classe pode NÃO ter EAN** (pão da padaria do mercado) — herda pela
   classe na mesma. **Por isso a worklist "por identificar" nunca pode depender do
   EAN**: senão o pão da padaria ficaria preso para sempre. O critério decide pela
   *natureza* (classe/álcool/não-alimentar), não pela presença de código de barras.

### O pipeline completo

```
 foto/PDF ──► extração (VLM/LLM) ──► item ─┬─► canonicalização ──► sku_normalizado
             + loop de auto-correção       │      (nome limpo,        │  grupo (11 valores)
             (reconcilia com o total)      │       formato→€/base)    │  unidade_base
                                           │                          ▼
                                           └─► EAN → produto_ean   produto_mestre
                                               (OFF: nutrição,     (vetor de FACETAS —
                                                marca, alergias)    seção 3)
```

### O passo central: canonicalização (do grito do talão ao nome limpo)

```
"BOL DIGESTIVE AVEIA CNT 425GR"            ← a linha crua do talão
 ├─ 1 FORMATO (regra)          425GR → 0,425 kg → preço vira €/kg comparável
 ├─ 2 MARCA (determinístico)   CNT → Continente (marca própria, sem LLM)
 ├─ 3 ABREVIATURAS             BOL → Bolacha (dicionário MINADO dos pares já
 │                             validados pelo operador — aprende do uso)
 ├─ 4 CATÁLOGO (busca interna) casa "Bolacha Digestive Aveia 425g" → EAN!
 ├─ 5 LLM (só o que sobrar)    nome canónico "Bolacha Digestive de Aveia"
 │                             (vocabulário de facetas fechado + cache)
 └─ 6 VERIFICAÇÃO              o nome é o único campo SEM checksum →
 ▼                             2.ª leitura por outro modelo, voto a 3
 SKU: Bolacha Digestive de Aveia · grupo doces · 0,425 kg · €/kg
```

**Determinístico primeiro:** cada item resolvido pelos passos 1–4 não custa nada —
a normalização por LLM é ~metade do custo de ingestão, e o catálogo é a alavanca
que a corta. O LLM trata só o que sobra, **uma vez** (o resultado fica em cache).

### As matérias-primas: fontes de produto (números reais, 2026-06-11)

Classificar exige **conhecimento externo** — catálogos das lojas, bases abertas e
as próprias compras. Cada fonte tem lacunas diferentes; o sistema **cruza-as**:

| Fonte | Produtos | EAN | Tamanho | Preço | Nota |
|---|---:|:---:|:---:|:---:|---|
| **Talões do utilizador** (66 notas, 6 cadeias) | 651 itens → 322 SKUs | 34% | ✓ | **pago = facto** | a fonte primária: preços reais e hábitos |
| Continente (scrape) | 19.102 | **100%** | 3% | ✓ | maior catálogo PT; nomes sem gramagem |
| Pingo Doce (scrape) | 15.144 | ✗ (**+2.388 inferidos**) | a crescer | ✗ | site não expõe EAN/preço; a `descricao_curta` é a abreviatura de talão |
| Auchan (scrape) | 11.998 | **100%** | 85% | ✓ | nomes com gramagem |
| Lidl-FR (lista QCE) | 9.390 | ✓ | ✗ | ✗ | só EAN + nome francês |
| Mercadona ES (API) | 5.060 | **100%** | 90% | ✓ (ES) | preço único nacional; `nome_pt` p/ matching |
| Mercadona own-brand (OFF) | 586 | ✓ | 63% | ✗ | nomes PT |
| Lidl PT (scrape) | 390 | ✗ | ✗ | 72% | pequeno |
| **Open Food Facts** (dump local) | 26.969 | ✓ | 47% | ✗ | **nutrição só 16%**, Nutri-Score 39% — completado on-demand pela API live |
| Fichas próprias (fotos+OFF) | 180 EANs | ✓ | — | — | 90% com nutrição |
| Genéricos frescos (por classe) | 291 (71 c/ nutrição) | — | — | — | "banana" tem nutrição conhecida por 100 g |

Três lições dos números: (1) **nenhuma fonte chega sozinha** — quem tem EAN não tem
nutrição, quem tem nutrição não tem preço; (2) a mesma informação ("tamanho") vem
**em sítios diferentes** por loja (no nome no Auchan, na abreviatura de talão no
Pingo Doce, em campo próprio no Mercadona); (3) os preços de catálogo são
**referência** — o preço-facto é o do talão.

---

## 3. Facetas, não árvore — a decisão central

A tentação natural é classificar em **árvore**:

```
ÁRVORE (rejeitada)                          FACETAS (adotada)
Iogurte                                     categoria = iogurte
 └─ Grego                                   estilo    = grego
     └─ Natural                             sabor     = natural
         └─ Ligeiro                         teor      = magro
```

**Por que a árvore falha:** ela obriga a escolher *uma* ordem de ramificação.
"Iogurte Ligeiro de Morango" e "Iogurte Grego Ligeiro" ficariam em ramos longe um
do outro, embora partilhem o atributo *ligeiro*. E a pergunta "quais iogurtes
**magros** temos?" exigiria varrer a árvore inteira procurando a palavra no nome —
que muitas vezes **nem está no nome** ("Ligeiro" = teor magro).

**O modelo facetado** trata cada atributo como uma **dimensão independente**.
Cada Produto Mestre é um vetor de 10 facetas (colunas no banco desde a migração 043):

```
categoria | apresentacao | corte | processamento | variedade | sabor | teor | estilo | funcao | fonte
iogurte   |      —       |   —   |       —       |     —     |natural|magro | grego  |   —    |  —
leite     |      —       |   —   |      UHT      |     —     |   —   |meio- |   —    |   —    | vaca
                                                                     |gordo |
```

Consultas viram SQL simples: `WHERE teor='magro'` devolve **todos** os magros,
qualquer que seja o nome. Os "níveis" da árvore passam a ser **projeções**
(agrupar por `categoria`, depois por `categoria+estilo`…), escolhidas na hora da
pergunta — não fixadas na estrutura.

### O grupo de prateleira (vocabulário fechado)

Acima das facetas há um **grupo grosso com 11 valores fechados** — frutas, carne,
peixe, laticínios, padaria, bebidas, doces, congelados, higiene, mercearia, outros —
usado para organizar a lista de compras e acelerar buscas. É derivado por força
decrescente: categoria de loja "Congelados" (sinal **físico** inequívoco) →
**nome** do produto (o nosso vocabulário) → `food_groups` do OFF → categoria da
loja (a mais fraca: prateleiras misturam, como "Charcutaria e Queijos").

> **Lição (2026-06-13): essa ordem foi INVERTIDA com dados.** A versão original
> punha o OFF primeiro ("é uma base curada, logo autoritativa") — e foi acumulando
> exceções-remendo (bebidas-vs-lácteos, bebidas-vs-mercearia…). Exceções a
> acumular são o cheiro de prioridade errada. Medimos a inversão contra o golden
> set: nos únicos 2 casos onde as ordens divergiam, o "ouro" estava **contaminado
> pelo próprio OFF** ("Patê de Alho" era *padaria* porque alguém no OFF lhe pôs a
> tag `en:bread`). Crowdsourcing perde para o vocabulário próprio + catálogo curado.

**Importante:** o grupo é **organização de UI** (lista de compras, percurso de
loja) — **não é a taxonomia** (essa é o vetor de facetas). E fechado ≠ imutável:
ração, bebé ou farmácia entram como novos valores quando os talões os trouxerem.

### Classificar pelo catálogo: o voto-por-vizinhança (2026-06-13)

As lojas já classificaram dezenas de milhares de produtos — usamos esse trabalho.
Para classificar um produto, **as linhas de catálogo votam**: com EAN, votam as
linhas diretas desse código; sem EAN, votam os ~80 vizinhos por nome. O voto é
ponderado pela **profundidade do caminho** (a família de 4 níveis do Auchan vale
mais que o "Mercearia" raso do Continente; vocabulário estrangeiro vale metade), e
só conta se for **fiável** (confiança ≥0,5 e ≥5 vizinhos — medido: 88% de acordo
nos fiáveis vs 78% no geral; os erros concentram-se nos frescos de 1 token, em que
"Banana" é *aroma* de centenas de processados: o gate de confiança bloqueia-os).

**E a que nível da hierarquia se classifica? Depende de PARA QUEM.** Um caminho
de loja tem 3 andares úteis — corredor / família / folha:

```
Mercearia  /  Arroz e Massa  /  Cotovelos Espiral e Massinhas
(corredor)     (FAMÍLIA)          (folha)
p/ organizar   p/ uma lista       p/ navegar 20.000
a loja toda    doméstica de 50    produtos no site
```

Levámos 3 iterações com dados reais: o corredor engolia metade do catálogo numa
seção "Mercearia"; a folha estilhaçou as massas da lista em 5 seções. **A
granularidade certa da exibição é a do caso de uso** (a família), mas o sistema
**guarda sempre o caminho completo** — exibição resume, classificação não perde.

### Como uma pergunta encontra produtos (cascata de matching)

```
"leite"  ──► 1. grupo fechado?  ("fruta" → grupo frutas)
             2. sinônimos expandidos ("álcool" → cerveja+vinho+…)
             3. TOKENS com substantivo-cabeça:  "leite" prefere SKUs que COMEÇAM
                por "Leite" → não mistura "Doce de Leite"; plural por
                SINGULARIZAÇÃO canônica dos DOIS lados (uvas→uva, pães→pão,
                limões→limão, integrais→integral), nunca por prefixo
                (sal→salmão ✗)
             4. fuzzy (erros de digitação)
             5. LIKE na descrição crua (último recurso)
```

Cada degrau só roda se o anterior não resolver. **Determinístico primeiro; o LLM
entra só onde texto livre exige interpretação — e com resultado cacheado.**

---

## 4. Vantagens do modelo

| Vantagem | Por quê |
|---|---|
| **Preços comparáveis** | tudo em €/base (€/kg, €/L, €/un) sobre o mesmo SKU — packs de tamanhos diferentes não enganam |
| **Agrupamento entre lojas** | "Leite Meio Gordo" do Lidl, Continente e Mercadona caem no mesmo SKU/Mestre |
| **Consultas por atributo** | `teor='magro'`, `estilo='grego'` — impossível por string |
| **Nutrição herdada** | da CLASSE (banana, arroz, pão — mesmo com EAN) ou do PRODUTO (marca, via EAN→OFF); decide a natureza do alimento, não a embalagem |
| **Barato e auditável** | classificação determinística: rápida, custo ~zero, e cada decisão é explicável (qual regra disparou) |
| **LLM só onde paga** | extração da imagem e interpretação de texto livre — sempre com cache (a 2.ª vez é grátis) |

---

## 5. Como medir a qualidade (e a armadilha do juiz)

Um classificador sem métrica de qualidade é uma opinião. Medimos em **3 camadas**
(números reais de 2026-06-11, 324 SKUs):

1. **Concordância com fonte independente (grátis).** O OFF traz `food_groups`
   próprios por EAN → comparar com o nosso grupo: **76%**. A leitura certa:
   a discordância **não diz quem errou — diz onde olhar** (das 13, a maioria
   éramos nós certos; mas apanhou um "Muesli" nosso em *frutas*).
2. **LLM-juiz** (a ideia óbvia — e funciona, com 4 regras de ouro):
   **outra família** de modelo que o pipeline (erros não correlacionados);
   **lotes pequenos** (40 — em listas grandes a atenção dilui);
   o juiz é **triagem, não veredicto** (36 flags → 25 falsos alarmes; o humano decide);
   e sobretudo: **calibrar com canários** — plantar 5 erros óbvios ("leite→peixe")
   e exigir que os apanhe.
3. **Resultado:** **10 erros reais em 324 (~3%)** — e com padrão comum, ouro para
   melhorar o classificador: uma palavra forte de outro grupo no nome vence o
   substantivo-cabeça (*Croissant de **Manteiga***→lacticínios, *Batata **Doce***→doces,
   ***Milka*** casa "milk"). Custo da auditoria inteira: cêntimos.

4. **Golden set de regressão (2026-06-13):** 325 casos reais com classificação
   auditada, congelados em fixture e corridos como **gate do deploy**. Mudou o
   vocabulário? O teste mostra o DIFF legível em 30 s; se a mudança é intencional,
   o fixture regenera-se no MESMO commit (o diff commitado é a documentação).
   Já pagou por si várias vezes: apanhou um drift real entre código e banco, uma
   regressão "Nectarina→bebidas" por um termo novo, e o ouro contaminado da
   inversão de sinais. **E o próprio gerador do golden tinha um bug** (lia a
   coluna errada e emitia fixture sem o gabarito) — apanhado porque o teste
   quebrou com `esperado=undefined`, não silenciosamente.

> **A armadilha que quase nos enganou:** as 3 primeiras rondas do juiz deram
> **"0 erros em 324"** — perfeição! Era um **bug de parsing nosso** (o juiz recebia
> a pergunta, mas nós líamos sempre uma resposta vazia). Só o teste de canários o
> denunciou: 0/5 erros plantados apanhados = impossível. Corrigido: 5/5.
> **Moral: o auditor também precisa de auditoria** — sem canários, teríamos
> reportado qualidade perfeita com um juiz que não estava a ler nada.

## 6. Problemas ainda não resolvidos

1. **Granularidade desigual do Mestre.** `categoria` é específica na carne
   ("carne de porco", "frango") e genérica nos laticínios ("iogurte"). Resolvido
   *por caso de uso* (alternativas: frescos cruzam pelo grupo, processados pela
   categoria), mas falta uma regra geral de granularidade.
2. **Marcas próprias fora do Open Food Facts.** EANs Lidl/Continente/Mercadona
   muitas vezes não estão no OFF → a ficha exige foto do rótulo (trabalho humano).
3. **Mesmo nome, vários EANs.** "Leite Meio Gordo" existe com um EAN por cadeia.
   O nome sozinho é ambíguo; a regra atual só reusa identificação quando o nome
   mapeia a **um único** EAN ou dentro da mesma cadeia.
4. **EAN válido-mas-errado.** O leitor de imagem pode trocar um dígito e produzir
   *outro EAN real* (passa no dígito verificador!). Mitigação prevista: cruzar com
   a descrição da linha.
5. **Vocabulário de facetas vivo.** Novos valores ("kefir", "sem lactose") exigem
   governança: hoje há um gate que rejeita valores fora do vocabulário, mas a
   curadoria é manual.
6. **Não-alimentares.** Detergente, papel — sem OFF, sem nutrição, categorias de
   loja caóticas. O voto-por-vizinhança já os apanha quando o catálogo os tem
   ("Pasta de Dentes"→higiene, folha "Papel Higiénico e Rolos"); busca web
   dedicada (fase C) continua por construir.
7. **Multi-país.** O mesmo modelo para Espanha (Mercadona) está desenhado, mas
   espera o primeiro talão espanhol real para validar a leitura.
8. **Famílias equivalentes entre lojas não somam.** "Arroz e Massa" (Auchan) e
   "Massas" (Continente) são a mesma família mas votam separadas — fragmenta o
   voto e divide seções por loja de origem. A semente da solução está minerada:
   3.421 EANs vendidos em ambas as lojas geram 234 pares de categorias
   equivalentes (≥3 EANs de suporte) — o mapa loja→canónico da Fase 3.

---

## 7. O ativo que estamos a construir

O OCR e o LLM, qualquer concorrente aluga à API. O que **não** se aluga é o
**grafo de equivalência entre cadeias**:

```
 Família:  Leite Meio Gordo                ← onde o PREÇO se compara (sem marca)
              │
 Produtos: Continente · Milbona/Lidl · Hacendado/Mercadona · Auchan
              │                            ← onde a NUTRIÇÃO é exata (com marca)
 EANs:     560…  ·  405…  ·  842…  ·  358…
                                           ← mesmo EAN = mesmo produto, em qualquer loja
```

Números reais: **3.420 EANs** vendidos por Auchan∩Continente (59% com o mesmo
preço — comparação perfeita, zero LLM); **2.562 EANs** herdados pelo Pingo Doce
por matching catálogo↔catálogo determinístico. Construído de forma auditável,
com o operador como juiz, e cresce a cada talão e re-scrape. **É o ativo mais
difícil de replicar do sistema.**

## 8. A lição de arquitetura (para levar para casa)

> **String não é taxonomia.** O nome do produto é uma *evidência*, não a
> *identidade*. A identidade é (1) o EAN quando existe, (2) um vetor de facetas
> quando não. E a estrutura de classificação não precisa ser uma árvore: facetas
> independentes + projeções sob demanda respondem a mais perguntas, com menos
> manutenção — e deixam o LLM no único papel em que ele é insubstituível:
> transformar linguagem humana bagunçada em valores desse vetor.

E três morais que esta fase acrescentou:

1. **Caso específico → regra geral.** Cada erro concreto ("Pérolas" caiu em
   *Roupa*; a camomila herdou um corredor vazio de informação) tem de virar a
   correção da **classe** de erro (guarda anti-colisão de EAN; filtro de nível
   raso) — nunca um remendo para aquele produto. Senão o classificador vira uma
   coleção de exceções que ninguém audita.
2. **Registar muda o jogo.** O backfill da fusão APLICA mas REGISTA o diff
   campo-a-campo. Foi o registo que expôs, em horas, 4 regressões que testes
   unitários não viram (o dump OFF a esconder a fonte curada; lixo-OCR a vencer
   por comprimento; a tradução clobberada; o símbolo ℮ virado "e").
3. **A granularidade de exibição é do caso de uso; a de armazenamento é a máxima.**
   A lista mostra a família; o sistema guarda a folha e o caminho inteiro — é
   dele que as comparações finas ("este chá preto vs outros chás pretos") virão.

# Como o BigBag classifica produtos de supermercado

*Documento didático (≈3 páginas) para apresentação em turma de graduação.
Derivado de `Taxonomia_Produto.md`, `Normalizacao.md` e `Conceito §11` — snapshot de 2026-06-11; não é fonte de verdade.*

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
- **Frescos** (banana, carne picada) não têm EAN útil → a identidade é o **nome**,
  e a nutrição vem da **classe** ("banana" tem nutrição conhecida por 100 g).

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
decrescente: `food_groups` do OFF (autoritativo) → **nome** do produto → categoria
da loja (a mais fraca: prateleiras misturam, como "Charcutaria e Queijos").

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
| **Nutrição herdada** | frescos sem EAN ganham nutrição pela classe (nome); embalados, pelo EAN→OFF |
| **Barato e auditável** | classificação determinística: rápida, custo ~zero, e cada decisão é explicável (qual regra disparou) |
| **LLM só onde paga** | extração da imagem e interpretação de texto livre — sempre com cache (a 2.ª vez é grátis) |

---

## 5. Problemas ainda não resolvidos

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
   loja caóticas. Plano: busca web dedicada (fase C), ainda não construída.
7. **Multi-país.** O mesmo modelo para Espanha (Mercadona) está desenhado, mas
   espera o primeiro talão espanhol real para validar a leitura.

---

## 6. A lição de arquitetura (para levar para casa)

> **String não é taxonomia.** O nome do produto é uma *evidência*, não a
> *identidade*. A identidade é (1) o EAN quando existe, (2) um vetor de facetas
> quando não. E a estrutura de classificação não precisa ser uma árvore: facetas
> independentes + projeções sob demanda respondem a mais perguntas, com menos
> manutenção — e deixam o LLM no único papel em que ele é insubstituível:
> transformar linguagem humana bagunçada em valores desse vetor.

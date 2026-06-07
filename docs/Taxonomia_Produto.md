# Taxonomia e normalização de produto — modelo-alvo

> **Caso de estudo:** iogurte grego. **Estatuto:** desenho/exploração (modelo-alvo), não a implementação atual.
> Complementa `Normalizacao.md` — esse descreve **o que o código faz hoje**; este descreve **para onde o modelo deve ir** e **porquê**, reusando standards em vez de reinventar.

## 0. Propósito e princípio

Construir um **modelo de classificação onde qualquer produto encaixa**, **independente do que vem nas notas**. Com esse modelo pronto, ler a nota deixa de *definir* o produto e passa a ser **mapear a descrição para o "balde" certo** e preencher as facetas que der — deixando vazias (não inventadas) as que a nota não dá.

Princípio transversal: **reusar standards abertos, não reinventar a roda.**

---

## 1. A ideia central

A identidade de um produto **não é uma string de nome** — é um **vetor facetado de atributos**. Normalizar resolve-se em três decisões:

1. **Quais facetas** descrevem o produto (eixos ortogonais).
2. **Em que nível** de agregação o colocamos (categoria → equivalente → específico → SKU físico).
3. **Como obter** cada faceta (parse / catálogo externo / cálculo).

---

## 2. Standards que reusamos (não reinventar)

| Standard | Estrutura | Acesso | Papel no nosso modelo |
|---|---|---|---|
| **Open Food Facts (OFF)** | Categorias em **DAG** (multi-pai), multilingue (**PT**), ligadas ao **EAN**; + taxonomias de **labels** (bio/vegan/sem-lactose) | API + dump aberto | **Espinha dorsal**: a árvore de categorias + os dados por código de barras |
| **GS1 GPC** | Segment→Family→Class→**Brick** + **atributos do brick** (≤7, vocabulário controlado) | Browser grátis; schema por registo | **Esquema de facetas** (atributos + valores controlados) |
| **IFPS PLU** | Códigos 4–5 díg. (conv. 3000/4000; **bio = prefixo 9**), por commodity/variedade | Search grátis | **Fresco** (fruta/legume sem EAN): variedade + bio |
| **OFF labels taxonomy** | bio · vegan · sem-lactose · sem-glúten… (controlado, multilingue) | dump aberto | Labels transversais |

**Crosswalk grátis:** cada nó OFF liga a **GS1 GPC** (`gpc_category_code`), **Google Product Taxonomy** e **Wikidata**. Ancorando no OFF, herdamos os outros.

**Decisão de design (verificada nos dados):** o OFF mistura duas estratégias — modela *algumas* facetas como **sub-categorias** (ex. `…-plain`, `…-on-a-bed-of-fruits`, `…-ewe-s-milk`) e outras como atributos. Nós **preferimos o modelo de ATRIBUTOS** (GS1) — mais limpo — e usamos o OFF como **âncora de categoria** + fonte de dados.

---

## 3. As três naturezas de atributo (decide a arquitetura de preenchimento)

| Natureza | Como se obtém | Facetas (exemplo iogurte) | Fiabilidade |
|---|---|---|---|
| **A — Textual** | **parse da descrição da nota** | classe · estilo · sabor · forma¹ · marca² · formato(quantidade) | alta |
| **B — Escondida** | **EAN → OFF** (ou catálogo) | base · teor · açúcar · proteína · bio · lactose | só com EAN/catálogo |
| **C — Derivada** | **cálculo** (de A+B ou do nosso histórico) | unidade_base · preço_por_base · tipo-dose · gama · Nutri-Score | grátis |

¹ forma: só quando "LIQ"/"beber" aparece; senão assume-se sólido (risco).
² marca: impressa **ou inferida da cadeia** (marca-própria: Mercadona→Hacendado, Aldi→Milsani…).

---

## 4. Os níveis = **projeções** das facetas (não campos separados)

| Nível | Facetas que o definem | Exemplo | Para quê |
|---|---|---|---|
| **Categoria** | classe (+ base) | *Iogurte Grego (láctea)* | "quanto gastei em grego?" |
| **Equivalente** | categoria + estilo + sabor + teor + açúcar + proteína + bio + lactose + forma | *Iogurte Grego Natural Magro* | comparar **marcas** @ €/base |
| **Específico** | equivalente **+ marca** | *…Magro Milsani* | **rastrear o preço** do que compro |
| **SKU físico** | específico **+ formato** | *…1 kg* / *…4×115 g* | a linha de prateleira |

A "categoria" não é um campo — é uma **consulta sobre facetas**. Subir/descer de nível = remover/adicionar facetas.

---

## 5. Princípio de **coorte** (comparação justa)

`preço_por_base` (€/kg, €/L) é **necessário mas não suficiente**. A comparação justa faz-se **dentro de uma coorte**:

> **coorte = (sabor × marca/gama × tipo-dose)**

Spreads reais observados que justificam isto: **marca/gama ~4×** · **formato/dose ~2×** · o **sabor** muda o produto. "Iogurte grego mais barato" sem coorte mistura económico-familiar com premium-individual.

---

## 6. Template — 🪣 Ficha de Balde: **Iogurte Grego**

### Identificação (verificada nos standards)
| Eixo | Valor |
|---|---|
| **Categoria OFF** | `en:greek-style-yogurts` · PT *"Iogurtes gregos"* |
| **Cadeia OFF** | `en:dairies › en:dairy-desserts › en:fermented-dairy-desserts › en:yogurts › en:greek-style-yogurts` |
| **GS1 GPC** | Brick **50301700** *Yogurt* (no nível `en:yogurts`) |
| **Wikidata** | `Q1147190` |
| **Vegan** | ramo **separado**: `en:greek-style-non-dairy-yogurts` ← `en:non-dairy-yogurts` (*vegetal corta na classe*) |

### Facetas (atributos · vocabulário controlado)
| Faceta | Valores | Fonte padrão | Natureza | No talão? |
|---|---|---|---|---|
| **Estilo** | grego(coado) · skyr · normal · batido · líquido | GS1 *Type* / OFF | A | ✅ |
| **Sabor** | natural · morango · coco · stracciatella · café · … | GS1 *Flavour* | A | ✅ |
| **Forma** | sólido(colher) · líquido(beber) | consistência | A | parcial → **decide unidade** |
| **Base** | vaca · cabra · ovelha · *(vegetal→outra classe)* | GS1 *Source* | B | raro |
| **Teor** | gordo/inteiro · meio-gordo · magro | GS1 *Level of Fat* | B | às vezes ("LIG","MG") |
| **Tratamento** | pasteurizado · UHT | GS1 *Treatment* | B | não |
| **Açúcar** | sem adição · açucarado · adoçante | OFF/UE | B | às vezes |
| **Proteína** | normal · fonte(≥12%) · rico(≥20%) | Reg. UE 1924/2006 | B | raro |
| **Bio** | sim/não | OFF `en:organic` | B | às vezes |
| **Vegan** | sim/não *(corta na classe)* | OFF `en:vegan` | B | às vezes |
| **Sem lactose** | sim/não | OFF `en:no-lactose` | B | às vezes |

### Universais
marca *(+ inferida da cadeia)* · formato (peso/volume × contagem) · preço · EAN/PLU/código interno

### Derivados (natureza C)
**unidade_base** (forma: sólido→kg, líquido→L) · **preço_por_base** · **tipo-dose** {individual·multipack·familiar} (de contagem+peso) · **gama** {própria·mainstream·premium} (do €/base observado) · **Nutri-Score** (OFF)

### Worked example — `"IOG MYTHOS CNT EQ NAT LIG 1KG"` [Continente]
| Faceta | Valor | Como |
|---|---|---|
| categoria | greek-style-yogurts | parse "GREGO/MYTHOS" |
| estilo | grego · **sabor** natural · **forma** sólido→€/kg | A |
| marca | Continente (Mythos) | A — marca-própria via cadeia |
| teor | ligeiro/magro | A ("LIG") |
| formato | 1 kg → dose=familiar | A→C |
| base | vaca *(assumido)* | B |
| açúcar·proteína·bio·lactose | **desconhecido** até EAN→OFF | B |

→ **~7 facetas do talão**; ~4 ficam vazias (não inventadas) até haver EAN.

---

## 7. Estratégia de preenchimento por tipo de produto

O **modelo-alvo é uniforme**; só o *como encher as facetas* depende do tipo:

| Tipo | Identificador | Catálogo | Natureza dominante |
|---|---|---|---|
| **Embalado** | EAN/GTIN | OFF (por EAN) | **B** (muito escondido) |
| **Fresco** (fruta/legume) | PLU (IFPS) · ou código interno | IFPS PLU + OFF produce | **A** (variedade no nome) |
| **Balcão** (talho/peixaria/charcutaria) | código interno | — (parse + contexto) | A |

O fresco é **mais "natureza A"**: a faceta-chave (variedade: "MAÇÃ GALA") **vem no nome**; depende pouco de EAN.

---

## 8. Mapear uma linha de talão para o balde

1. **Parse** → facetas de natureza A (classe, estilo, sabor, forma, marca-ou-cadeia, formato).
2. **(Se houver EAN/PLU)** → catálogo (OFF/IFPS) → facetas de natureza B.
3. **Derivar** natureza C (unidade, preço_por_base, dose, gama).
4. **Resolver ao nível específico** (com marca) — **não colapsar a marca**.
5. Agrupar em equivalente/categoria via **consulta de facetas** (não por fusão destrutiva).
6. Facetas sem fonte ficam **vazias**, nunca inventadas.

---

## 9. Relação com a implementação atual (lacunas a fechar)

O modelo de hoje (`Normalizacao.md`) **achata** este desenho: um `nome_canonico` de texto livre (mistura estilo+sabor), `marca` **colapsada** no auto-merge, `categoria` larga demais, sem coorte. Lacunas, por valor/custo:

1. **Parar o colapso de marca** (auto-merge só dentro da mesma marca) — baixo custo.
2. **Corrigir a unidade pela forma** (líquido→€/L mesmo rotulado em g; bug do kefir) — baixo.
3. **Coorte na consulta** (casar sabor; mostrar marca/gama/dose) — médio.
4. **Facetas como campos** (estilo, sabor) em vez de enterradas no nome — médio.
5. **EAN (scan) → OFF** para a natureza B — alto (desbloqueia base/teor/proteína/bio).
6. **gama derivada** do €/base; **Nutri-Score** do OFF — baixo.

A migração é **incremental**; o `nome_canonico + marca + unidade_base` aguenta o MVP **desde que se pare de colapsar a marca**.

---

## 10. Perguntas em aberto

- **Vegetal:** classe-irmã (como o OFF) vs. faceta `base`? — os dados do OFF apontam **classe-irmã**.
- Quanto do esquema facetado vira **campos** vs. fica no nome (trade-off MVP).
- **Captura do EAN** (scan no momento da compra?) — é o que desbloqueia a natureza B.
- Metodologia da **gama** derivada (clustering por €/base; risco de circularidade).
- **Defaults da coorte** na consulta (que faceta assumir quando o utilizador não especifica).

---

## Fontes

- Open Food Facts — taxonomias: <https://wiki.openfoodfacts.org/Global_categories_taxonomy> · dados/API: <https://world.openfoodfacts.org/data>
- GS1 GPC — como funciona: <https://www.gs1.org/standards/gpc/how-gpc-works> · browser: <https://gpc-browser.gs1.org/>
- IFPS PLU: <https://www.ifpsglobal.com/plu-codes>
- Reg. (CE) 1924/2006 (alegações nutricionais): <https://eur-lex.europa.eu/eli/reg/2006/1924/oj?locale=pt>
- Denominação "iogurte" reservada (UE): <https://agriculturaemar.com/ue-quer-retirar-a-frase-alternativa-ao-iogurte-das-embalagens-dos-produtos-de-origem-vegetal-alpro-e-contra-as-restricoes-adicionais/>

*Verificação dos dados OFF (cadeia, filhos, ramo vegan, Wikidata) feita sobre o dump `categories.json` em 2026-06-07.*

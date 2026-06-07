# Taxonomia e normalização de produto — modelo-alvo

> **Casos de estudo:** iogurte grego · maçã · leite · queijo. **Estatuto:** desenho/exploração (modelo-alvo), não a implementação atual.
> Complementa `Normalizacao.md` — esse descreve **o que o código faz hoje**; este descreve **para onde o modelo deve ir** e **porquê**, reusando standards em vez de reinventar.
> **Consolidado (2026-06-07)** com 5 revisões externas + experiências empíricas (head-to-head de extração, classificação, chave do Mestre, e novo-vs-antigo nos dados reais) + decisões de portão do dono. Marcas: **[rev]** = de revisão; **[dono]** = decisão do dono.

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

> **Exceção nomeada — categorias por denominação [rev].** A regra "atributos, não sub-categorias" **tem uma exceção**: produtos cuja identidade É uma **denominação** (queijos: *Gouda*, *Manchego*; vinhos; massas com nome). Aí o **nó OFF da denominação é a identidade**, e os pais da DAG dão facetas **de graça** (ex. `en:gouda` → pais `[en:cow-cheeses, en:uncooked-pressed-cheeses]` = fonte **+** textura). Nestes casos **ancora-se na denominação** e herda-se a DAG — não se força tudo a atributos. *(Não aplicar a regra do §2 dogmaticamente a estas categorias.)*

---

## 3. As três naturezas de atributo (decide a arquitetura de preenchimento)

| Natureza | Como se obtém | Facetas (exemplo iogurte) | Fiabilidade |
|---|---|---|---|
| **A — Textual** | **parse da descrição da nota** | classe · estilo · sabor · forma¹ · marca² · formato(quantidade) | alta |
| **B — Escondida** | **EAN → OFF** (ou catálogo) | base · teor · açúcar · proteína · bio · lactose | só com EAN/catálogo |
| **C — Derivada** | **cálculo** (de A+B ou do nosso histórico) | unidade_base · preço_por_base · tipo-dose · gama · Nutri-Score | grátis |

¹ **forma:** não confiar no parse [rev] — "LIQ" raramente aparece (ex. kefir). A **unidade vem da CATEGORIA** (ver §4.1): o balde fixa o default; o formato só corrige exceções.
² **marca = faceta própria** [rev], **não** "= cadeia". Ler quando impressa; quando ausente, **inferir num passo separado e com confiança** (marca-própria: Mercadona→Hacendado, Aldi→Milsani…) — nunca acoplar ao campo `cadeia`, que é frágil e não 1:1 (Continente → Continente/Seleção/Mythos…). **Marca desconhecida** é um valor válido (não "igual a tudo") — crítico para o agrupamento (§4).

---

## 4. Os níveis = **projeções** das facetas (não campos separados)

| Nível | Facetas que o definem | Exemplo | Para quê |
|---|---|---|---|
| **Categoria** | classe (+ base) | *Iogurte Grego (láctea)* | "quanto gastei em grego?" |
| **Produto Mestre** *(= "equivalente")* | **identidade = só facetas A**: categoria + estilo + sabor + teor(quando parse) + forma | *Iogurte Grego Natural Magro* | comparar **marcas** @ €/base |
| **Específico** | Produto Mestre **+ marca** | *…Magro Milsani* | **rastrear o preço** do que compro |
| **SKU físico** | específico **+ formato** | *…1 kg* / *…4×115 g* | a linha de prateleira |

A "categoria" não é um campo — é uma **consulta sobre facetas**. Subir/descer de nível = remover/adicionar facetas.

> **A identidade do Mestre são SÓ facetas A [rev].** As facetas B (açúcar, proteína, bio, lactose, e `teor` quando só vem do EAN) são **descritivas** do Mestre — **nunca chave**. Senão, ligar o EAN mais tarde **re-particiona o histórico em silêncio** (um item com `açúcar` preenchido partir-se-ia dos gémeos com `açúcar=null`). Define-se o Mestre pelo que é **estável a partir do parse**; pendura-se o resto. *(O `teor` é o caso misto: entra na chave quando vem do parse; quando só viria do EAN, cai na política "ausente" do Spec.)*

### 4.1 — Produto Mestre: agrupar, NÃO fundir [rev]

A peça-chave que resolve a dívida do "colapso de marca". **Não fundir marcas num SKU** (destrutivo, e depende de a marca ser fiável no momento do merge — o elo mais fraco). Em vez disso, **cada SKU específico (com a sua marca) liga a um Produto Mestre partilhado** (o brand-free equivalente):

```
Iogurte Grego Natural Magro   ← Produto Mestre (agrupa p/ comparar)
 ├─ … Pingo Doce      (específico, marca própria)
 ├─ … Mythos/Continente
 ├─ … Milsani/Aldi
 └─ … Oikos/Danone
```

- **Nunca se perde a marca** (cada específico mantém-na); compara-se subindo ao Mestre.
- **Marca desconhecida** → fica como específico próprio, **não** se funde com os outros (evita o sobre/sub-merge).
- **O Mestre é ENTIDADE materializada, não view [rev]** — não só por performance: a aba **"Ligar nomes"** do operador precisa de onde guardar **overrides humanos** que contrariam a chave automática ("estes dois são o mesmo Mestre apesar das facetas não baterem"). Uma view não tem onde os guardar. **Chave automática = default; override do operador vence.**

> ⚠️ **O problema não desaparece — muda de sítio [rev].** O Mestre troca "a marca é fiável no merge?" por "**este específico liga ao Mestre certo?**" — a mesma classificação fuzzy. O perigo é o **sub-agrupamento** (o mesmo Mestre partido em dois sempre que um talão diz "MG", outro "MAGRO", um terceiro omite o teor), que destrói exatamente o que se quer comparar. Por isso a **chave do Mestre precisa de normalização de VALORES** (não só de presença) e de **política ausente-vs-diferente** — é o **Spec do Produto Mestre** (§11), o próximo artefacto.

### 4.2 — A unidade vive na CATEGORIA, não no formato [rev]

Cada **balde fixa a sua unidade-base por defeito** (líquido → €/L; sólido a peso → €/kg; contado → €/un). O parse do formato **só corrige exceções**, nunca decide a unidade.
→ Isto mata o **bug do kefir** (líquido rotulado em "480G" que o parse leria como kg): *Kefir* é categoria líquida → €/L, ponto. Confirmado pela experiência: até modelos fortes erraram a unidade a partir do formato.

---

## 5. Princípio de **coorte** (comparação justa)

`preço_por_base` (€/kg, €/L) é **necessário mas não suficiente**. A comparação justa faz-se **dentro de uma coorte**. **Correção [rev]:** a versão antiga (`sabor × marca/gama × dose`) **contradiz-se** — punha `gama` como portão ("não misturar gamas") mas o Mestre existe para **comparar marcas**, e as marcas **atravessam gamas** (Aldi económico vs Oikos premium). Não dá para ter as duas.

**Resolução — portões vs dimensões:**
> **coorte = identidade do Mestre = (categoria × portões da categoria)** — as facetas que tornam o produto **insubstituível** (ver a tabela de portões em §5.2).
> **marca · gama · dose** = **dimensões**: ordenam-se, mostram-se e (opcional) filtram-se — **nunca são portões**.

Ou seja, **a coorte É o Produto Mestre** (§4). "O grego natural magro mais barato" devolve honestamente o do **Aldi**, e a UI **assinala o tier e a dose** (= a "sinalização ao utilizador" do §5.1). Spreads que justificam mostrar as dimensões: marca/gama ~4× · dose ~2×.

> **Bónus [rev]:** isto **dissolve a circularidade do gama**. O gama deixa de ser portão → calcula-se sobre uma coorte **gama-free** → some o laço `gama ∈ coorte ∧ gama ← f(preços da coorte)`. Um só corte arruma a contradição **e** a circularidade.

### 5.1 — Defaults de coorte: item de DESIGN, não pergunta em aberto [rev]

Os **portões** (identidade do Mestre) já estão definidos; o difícil é o que fazer quando a consulta é **vaga** (a voz quase nunca diz tudo). **É política de produto na camada de consulta** — provavelmente o que mais decide se a voz "soa bem". Por categoria:
- **quais portões assumir** quando o utilizador não os dá (ex.: iogurte → assumir *Natural*; leite → assumir *meio-gordo*? ou perguntar?);
- **default das dimensões** (ex.: ordenar por €/base, **mostrar** o tier e a dose do vencedor) — nunca filtrar em silêncio;
- **sinalização** da coorte escolhida ("o grego **natural magro** mais barato é o do Aldi, **tier económico**, balde 1 kg") — sem isto, engana sem o admitir;
- **fallback** quando um **portão** é desconhecido no item (relaxa **e di-lo**, em vez de comparar à toa).

Isto vive no **Spec do Produto Mestre (§11)** — o próximo artefacto.

### 5.2 — Critério e tabela de PORTÕES por categoria [dono, 2026-06-07]

O **critério** que decide se uma faceta é portão ou dimensão (fixado pelo dono):
> **Portão** = mantém-se **constante** para comparar (não substituirias um valor pelo outro): comparas *fatiado-com-fatiado*, *peito-com-peito*, *branqueador-com-branqueador*.
> **Dimensão** = compara-se **entre** valores (é esse o objetivo): que **marca**/**gama**/**dose** é mais barata.

**Dimensões — sempre (nunca portão):** `marca · gama · dose/tamanho`. *(A dose normaliza-se por €/base; a diferença é o desconto de quantidade, informativa.)*

**Portões — específicos da categoria** (semente; as listas grandes vêm do OFF/GS1):

| Categoria | Portões |
|---|---|
| **Iogurte** | estilo · sabor · teor |
| **Leite** | teor · (tratamento) |
| **Queijo** | denominação · **apresentação** (inteiro/fatiado/ralado) · fonte |
| **Carne** | animal · **corte** · processamento (inteiro/moída/preparado) |
| **Higiene** (pasta de dentes) | **função/variante** (branqueador/multi/gengivas…) |
| **Fruta / legume** | variedade · apresentação (inteiro/cortado) |
| **Transversal** | **apresentação/processamento** é portão **onde existir** (muda o preço ao mesmo peso) |

⚠️ **`apresentação` ≠ `dose`:** apresentação (fatiado vs pedaço) é **portão** (preço difere ao mesmo peso); dose (200 g vs 1 kg da *mesma* apresentação) é **dimensão** (€/kg normaliza).

**Validado pelos dados:** os três erros do teste novo-vs-antigo — Gouda inteiro **fundido** com fatiado, Peito **fundido** com Lombinhos, Bexident **fundido** com Parodontax — traçam-se **todos** à falta destes portões (`apresentação`, `corte`, `função`) na chave plana. Confirma que **a chave do Mestre precisa dos portões da categoria** (não uma chave universal plana).

### 6.1 — Iogurte Grego (embalado · identidade escondida → EAN)

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

### 6.2 — Maçã (fresco, sem EAN · identidade no nome → parse)

O **mesmo template**, mas o perfil de preenchimento **inverte-se** (quase tudo natureza A).

#### Identificação (verificada nos standards)
| Eixo | Valor |
|---|---|
| **Categoria OFF** | `en:apples` · PT *"Maçãs"* · Wikidata `Q89` |
| **Cadeia OFF** | `en:plant-based-foods-and-beverages › en:plant-based-foods › en:fruits-and-vegetables-based-foods › en:fruits-based-foods › en:fruits › en:apples` |
| **IFPS PLU** | por variedade (Gala **4133** · Fuji **4129** · …); **bio = prefixo 9** (→ `94133`) |
| **DAG** | `en:gala-apples` tem **dois pais**: `en:apples` **+** `en:sweet-apples` (faceta *grupo de sabor* como categoria-overlay) |

#### Facetas (fruta fresca)
| Faceta | Valores | Fonte | Natureza | No talão? |
|---|---|---|---|---|
| **Variedade** | Gala · Royal Gala · Golden · Fuji · Granny Smith · Reineta · Bravo de Esmolfe… | OFF children / IFPS PLU | **A** | ✅ **no nome — a faceta-chave** |
| **Grupo de sabor** | doce · ácida | OFF (sweet/acidic) | C (da variedade) | — |
| **Uso** | mesa/sobremesa · culinária (cozer: Bramley/Reineta) | OFF/conhecimento | C | — |
| **Origem** | Portugal · Madeira · import | etiqueta/contexto | A/B | às vezes ("nacional") |
| **Produção** | convencional · bio | OFF `en:organic` / PLU(9) | A/B | às vezes |
| **Classe/calibre (UE)** | Extra/I/II · calibre | norma UE/etiqueta | B | raro |
| **Forma/processamento** | inteiro(fresco) · polpa · calda · cozido | OFF children | A | sim (se processado) |
| **Universais** | peso · unidade=**kg** · preço · PLU/código interno | — | A/C | ✅ |

#### Worked example — `"MAÇÃ GALA"` (a peso)
| Faceta | Valor | Como |
|---|---|---|
| categoria | Maçãs (`en:apples`) | parse "MAÇÃ" |
| **variedade** | **Gala** | A ✅ — no nome → PLU 4133 |
| forma | inteiro/fresco · unidade=**€/kg** | A→C |
| origem·produção·classe | **desconhecido** até etiqueta | A/B |

→ **A faceta-chave (variedade) vem do talão.** Contraste com o iogurte: aqui **dispensa-se o EAN**.

### 6.3 — O que os dois templates provam (generalização)
| | Iogurte (embalado) | Maçã (fresco) |
|---|---|---|
| Identidade está… | **escondida** (B) | **no nome** (A) |
| Precisa de EAN? | **sim** | **não** (variedade parseável; PLU é bónus) |
| Identificador | EAN→OFF | PLU(IFPS) / código interno |

→ **Modelo-alvo idêntico** (categoria + facetas + universais + derivados); muda só o **plugin de preenchimento**. Confirma a tese: *construir o modelo primeiro, encaixar a nota depois.*

**Dois bónus que a maçã expõe:**
1. A velha dor **"Maçã Gala vs Royal Gala"** é, afinal, **resolução de variedade** (Royal Gala é um *sport*/clone da Gala → ~mesmo equivalente para preço). Precisa de uma **camada de sinónimos**.
2. **O OFF já traz essa camada** — as taxonomias têm **sinónimos + stopwords** para *matching* ("Royal Gala" → `en:gala-apples`). Mais uma coisa que não inventamos.

---

### 6.4 — Leite (líquido · uma faceta-chave dominante → limpo)

- **OFF:** `en:milks` · PT *"Leites"* · Wikidata `Q8495` · cadeia `laticínios › Milks (liquid and powder) › Leites`

| Faceta | Valores | Natureza | No talão? |
|---|---|---|---|
| **Teor** | gordo · meio-gordo · magro/desnatado | A | ✅ **a faceta-chave** ("M/G","MAGRO") |
| **Tratamento** | UHT · fresco · pasteurizado · microfiltrado | A | ✅ ("UHT") |
| **Origem do leite** | vaca · cabra · ovelha · búfala | B | raro (vaca assumido) |
| **Lactose** | com · sem | A/B | às vezes |
| **Forma** | **sempre líquido → €/L** | C | fixo |
| **Aromatizado/enriquecido** | natural · chocolate · +cálcio/vitaminas | A | às vezes |

🎯 **Vegetal = classe-irmã** (confirmado): `en:plant-based-milk-alternatives` (PT *"Leites de planta"*) → pais `["en:milk-substitutes","en:plant-based-beverages"]` — **não** está sob `en:milks`.

→ **Caso limpo:** UM balde, faceta-chave (**teor**) **no nome**, **unidade fixa (€/L)**.
*Worked example* `"LEITE M/G UHT MIMOSA 1L"` → teor=meio-gordo · trat=UHT · marca=Mimosa · 1 L → €/L. **Tudo natureza A.**

---

### 6.5 — Queijo (denominação · multi-axial → o caso difícil)

- **OFF:** `en:cheeses` · PT *"Queijos"* · Wikidata `Q10943` · **81 filhos** · cadeia `laticínios › Produtos lácteos fermentados › Queijos`

**Porque é difícil:** **não há faceta-chave única** — a identidade é uma **combinação**.

| Faceta | Valores | Natureza | No talão? |
|---|---|---|---|
| **Tipo/denominação** | Gouda · Mozzarella · Manchego · Parmigiano · Flamengo · Serra da Estrela · Emmental… | A | ✅ (o "nome" do queijo) |
| **Origem do leite** | vaca · cabra · ovelha · búfala · mista | A/B | às vezes |
| **Cura/textura** | fresco · curado · semicurado · amanteigado · azul · fundido | A | às vezes |
| **Forma/apresentação** | inteiro/cunha · **fatiado** · **ralado** · barra · porções | A | ✅ ("FAT","RALADO") |
| **DOP/IGP** | sim/não (Serra da Estrela DOP, Manchego DOP) | A | ✅ ("DOP") |
| **Unidade** | **€/kg** (peso) ou por embalagem | C | — |

🎯 A **denominação é um nó OFF próprio** (e DAG): `en:gouda` → pais `["en:cow-cheeses","en:uncooked-pressed-cheeses"]` (*fonte* **+** *textura*). `en:parmigiano-reggiano` → `en:italian-cheeses`. `en:sliced-cheeses` = a **forma** como categoria.

**Duas armadilhas:**
1. **A forma é coorte** (como a dose no iogurte): *Gouda fatiado* ≠ €/kg de *Gouda em barra* — mesmo queijo. Comparar tem de casar a forma.
2. **"Tipo" não é marca nem variedade** — é uma **denominação** (às vezes DOP). Ancora-se no nó OFF do queijo nomeado.

→ **Resolução:** âncora = nó OFF da denominação; facetas = source + cura + **forma** + DOP; **coorte = (tipo × forma)**.
*Worked example* `"QJ GOUDA FAT PD 200G"` → tipo=Gouda · forma=fatiado · fonte=vaca · marca=Pingo Doce · €/kg.

---

### 6.6 — Os quatro arquétipos (o que os templates provam)

| Balde | Arquétipo | Faceta-chave | Identidade vem de | Unidade |
|---|---|---|---|---|
| Iogurte grego | **embalado-escondido** | (várias) | EAN→OFF (B) | €/kg |
| Maçã | **fresco-no-nome** | variedade | parse (A) | €/kg |
| Leite | **líquido-teor** | teor | parse (A) | €/L (fixo) |
| Queijo | **denominação-multiaxial** | (combinação) | parse + coorte | €/kg |

O **mesmo modelo** (categoria OFF + facetas + universais + derivados + coorte) cobre os quatro; muda só *quantas* facetas, se há uma dominante, e o *plugin de preenchimento*. O queijo é o argumento mais forte para **facetas estruturadas + coorte** — o nome livre colapsa-o.

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

1. **Parse** → facetas de natureza A (classe, estilo, sabor, formato). **Marca** num passo próprio (impressa, ou inferida com confiança).
2. **(Se houver EAN/PLU)** → catálogo (OFF/IFPS) → facetas de natureza B.
3. **Unidade da CATEGORIA** (§4.2); depois **derivar** o resto da natureza C (preço_por_base, dose, gama).
4. **Resolver ao nível específico** (com marca) — **um específico por marca**, marca-desconhecida fica isolada.
5. **Ligar ao Produto Mestre** (§4.1) — agrupamento **não-destrutivo**; equivalente/categoria são **consultas de facetas**.
6. Facetas sem fonte ficam **vazias**, nunca inventadas.

---

## 9. Relação com a implementação atual (lacunas a fechar)

O modelo de hoje (`Normalizacao.md`) **achata** este desenho: um `nome_canonico` de texto livre (mistura estilo+sabor), `marca` **colapsada** no auto-merge, `categoria` larga demais, sem coorte. Lacunas, por valor/custo (matriz consolidada das revisões):

| # | Lacuna | Impacto | Custo | Prioridade |
|---|---|---|---|---|
| 1 | **Não fundir marcas — ligar a Produto Mestre** (§4.1); marca-desconhecida isolada | 🔥 alto | 🟢 baixo | **Fase 1** |
| 2 | **Unidade pela categoria** (§4.2), não pelo formato (bug do kefir) | 🟡 médio | 🟢 baixo | **Fase 1** |
| 3 | **Coorte + defaults na consulta** (§5.1) | 🔥 alto | 🟡 médio | **Fase 1–2** |
| 4 | **Facetas como campos** (estilo, sabor, teor, forma) | 🟡 médio | 🟡 médio | Fase 2 |
| 5 | **gama em batches** (§10) + **Nutri-Score** (OFF) | 🟡 médio | 🟢 baixo | Fase 2 |
| 6 | **EAN (scan) → OFF** (natureza B) | 🚀 extremo (longo prazo) | 🔴 alto | **só depois da captura de EAN** |

**A dívida real de desenho** (não "abstrata"): a dependência **marca→merge** (resolvida pelo Produto Mestre, que não funde) e os **defaults de coorte** (§5.1). O resto está bem pensado.

**Leitura sóbria [rev]:** para um utilizador único, **~90% do valor está em Fase 1** (coorte + Produto Mestre + unidade-por-categoria — tudo barato). A **camada B (EAN→OFF) é andaime aspiracional** até existir captura de EAN — **não construir scaffolding B antes** de haver um produto com EAN na BD. *(Nuance: alguns atributos B de produtos famosos — Manchego→ovelha — vêm dos priors do LLM hoje, com confiança baixa.)*

---

## 10. Decisões e eixos de futuro

**Fechado [rev]:**
- **Vegetal = classe-irmã** (não faceta `base`) — verificado no OFF em 3 produtos (iogurte/leite/queijo: ramo vegetal sempre separado). Legal (UE: "iogurte"/"leite" reservados a lácteo) e de consumo (ecossistemas competitivos diferentes).
- **gama** = etiqueta derivada do €/base, **calculada em batches de background** [rev] (ex.: recálculo semanal dos percentis da coorte) e **fixada entre recálculos** — evita a circularidade e a oscilação em tempo real.

**Em aberto:**
- Quanto do esquema facetado vira **colunas** vs. fica num `facetas` JSON (perf vs. flexibilidade) — provável **híbrido**: promover a colunas só as facetas usadas na coorte (estilo, sabor, teor, forma, marca).
- **Estratégia de captura do EAN** — o maior desbloqueador da natureza B (scan na app quando o produto interessa; sem gamificação, que é para multi-utilizador).

**Eixos de futuro a prever (não construir agora) [rev]:**
- **Taxonomias ORTOGONAIS**, além da natureza-do-produto: uma **de consumo/ocasião** ("pequeno-almoço", "snack") e uma **nutricional** ("proteína") — para "quanto gasto em X?". O OFF **já as traz** (`food_groups`, `pnns_groups`) → não reinventar.
- **Multi-país:** guardar desde já `country · retailer · language · currency` em cada compra (campos baratos; a *lógica* multi-país fica para quando houver 2.º país). O modelo (OFF) é internacional.

---

## 11. Spec do Produto Mestre (o próximo artefacto)

Toda a dívida de desenho que resta aterra aqui (5ª revisão, Pontos 1–4). Um **Produto Mestre** é a entidade materializada que agrupa específicos comparáveis. Esta é a sua especificação.

### 11.1 — Chave de identidade
- **Categoria + os PORTÕES dessa categoria** (§5.2), só facetas A (estáveis a partir do parse). **Não é uma chave plana universal** — os portões mudam por categoria (carne: animal+corte+processamento; queijo: denominação+apresentação+fonte; iogurte: estilo+sabor+teor).
- **B é descritivo, nunca chave** (açúcar, proteína, bio, lactose, teor-de-EAN) → pendura-se no Mestre, não o particiona. *(Garante que ligar o EAN mais tarde nunca re-particiona o histórico.)*
- **Categoria resolvida a um nó OFF FINO** (banana, não "fruta"; cenoura, não "vegetal") — senão sobre-une (erro comprovado no teste novo-vs-antigo).
- Chave canónica = **tuplo normalizado** (categoria-OFF + portões), via 11.2.

### 11.2 — Normalização de VALORES (não só de presença)
Cada faceta tem **vocabulário controlado** + **dicionário de sinónimos/abreviaturas** que mapeia o texto do talão ao valor canónico, **por contexto de categoria**. Ex. (teor):
| Canónico | Sinónimos no talão |
|---|---|
| meio-gordo | `M/G` · `MG`(ctx. leite) · `meio gordo` · `semi` |
| magro | `MAGRO` · `MAG` · `0%` · `desnatado` |
| gordo | `GORDO` · `INTEIRO` · `G` |

⚠️ O caso **`MG` vs `M/G`** prova que a normalização é **dependente da categoria** (o mesmo token difere). Fonte: OFF labels/synonyms **+** a nossa cache de abreviaturas. *(É a "camada de sinónimos" do §6.2 — mas aplicada à **chave inteira**, não só a variedades.)*

**Canonicalização de denominação (caso queijo).** Provámos empiricamente que o LLM é **não-determinístico a COLOCAR a denominação**: para o mesmo queijo devolve ora `categoria="queijo gouda"`, ora `categoria="queijo" + variedade="gouda"`, ora perde-a, ora varia a ortografia (`mozarela`/`mozzarella`). Nenhum ajuste de prompt o estabiliza. Solução: uma camada **determinística** em `chaveMestre` (`canonQueijo`) que, seja qual for a saída do LLM, normaliza para `categoria="queijo" + variedade=<denominação canónica>` — com mapa de ortografia, remoção de `DOP`/`IGP` do nome, e exceções com categoria própria (requeijão · burrata · ricotta · mascarpone · queijo creme). Resultado medido (30 descrições reais): denominação consistente; os splits que sobram são **corretos** (apresentação é portão: gouda bola ≠ gouda fatiado) ou **ruído de OCR** (`PADANG`←`Padano`). É o padrão a replicar quando uma categoria tiver vocabulário fechado de denominações (a generalização futura resolve a denominação a um **nó OFF fino**, §11.1).

### 11.3 — Política ausente-vs-diferente (o cerne)
Quando uma faceta-**portão** falta no item:
- **NÃO** assumir um valor (não fundir às cegas no `magro`).
- **NÃO** tratar `null` como wildcard (casaria com tudo → ambíguo).
- O item liga a um **Mestre provisório "faceta-desconhecida"** (ex.: *Iogurte Grego Natural · teor=?*), candidato a **promoção** quando uma fonte resolver a faceta (re-leitura · EAN · operador).
- **Regra de ouro: enriquecer nunca PARTE um Mestre** (a chave é A-estável); só pode **promover** um provisório a concreto.

### 11.4 — Regra de atribuição (específico → Mestre)
1. Constrói a **chave normalizada** (11.2) das facetas A.
2. **Match exato de chave** → liga.
3. **Sem match** → candidatos (categoria igual + chave próxima); `≥ limiar` → liga (com confiança); `< limiar` → **novo Mestre**.
4. **Override do operador vence sempre** (entidade materializada; aba "Ligar nomes").
5. Portão ausente → 11.3.

### 11.5 — Coorte = o Mestre (derivada)
A coorte de uma consulta de preço **é o conjunto de específicos sob um Mestre**. `marca · gama · dose` são **dimensões** (ordenar/mostrar/filtrar), nunca portões (§5).

### 11.6 — Materialização (esboço de schema)
- `produto_mestre` (id · chave_normalizada · categoria · facetas-A · + facetas-B **descritivas nuláveis** · provisorio bool).
- O **específico** (≈ o `sku_normalizado` de hoje) ganha `mestre_id` + mantém a marca.
- `sku_alias` + aba "Ligar nomes" alimentam **overrides**.

### 11.7 — O que isto fecha
Os Pontos 1–4 da 5ª revisão (sub-agrupamento · coorte×Mestre · B-fora-da-chave · corrigibilidade). **Substitui** o "meta-schema da coorte" — porque a **coorte é o Mestre**.

---

## Fontes

- Open Food Facts — taxonomias: <https://wiki.openfoodfacts.org/Global_categories_taxonomy> · dados/API: <https://world.openfoodfacts.org/data>
- GS1 GPC — como funciona: <https://www.gs1.org/standards/gpc/how-gpc-works> · browser: <https://gpc-browser.gs1.org/>
- IFPS PLU: <https://www.ifpsglobal.com/plu-codes>
- Reg. (CE) 1924/2006 (alegações nutricionais): <https://eur-lex.europa.eu/eli/reg/2006/1924/oj?locale=pt>
- Denominação "iogurte" reservada (UE): <https://agriculturaemar.com/ue-quer-retirar-a-frase-alternativa-ao-iogurte-das-embalagens-dos-produtos-de-origem-vegetal-alpro-e-contra-as-restricoes-adicionais/>

*Verificação dos dados OFF (cadeia, filhos, ramo vegan, Wikidata) feita sobre o dump `categories.json` em 2026-06-07.*

# Bigbag como conselheiro de saúde alimentar do agregado

> Documento de **visão**. Captura a direção do projeto para além do histórico de preços:
> usar a mesma máquina de classificação facetada para avaliar a **nutrição e saúde**
> das compras de uma família ao longo do tempo. Sem segredos nem dados pessoais.
> Última atualização: 2026-06-07.
>
> **Ver também:** [`Taxonomia_Produto.md`](Taxonomia_Produto.md) (modelo facetado),
> [`Normalizacao.md`](Normalizacao.md) (estado), [`Paper_Resolucao_Produtos_Talao.md`](Paper_Resolucao_Produtos_Talao.md) (método).

## 1. O salto de visão

O Bigbag começou como **histórico de preços** ("onde está mais barato o leite?"). A
observação que muda a natureza do projeto: uma família que regista **todas as suas
compras de supermercado durante meses** produz, sem esforço, um **diário alimentar
passivo e completo** do agregado. Sobre esse diário, o **preço passa a ser uma faceta
entre outras** — e a **nutrição/saúde é tão ou mais importante**.

O objetivo de 1.ª classe passa a ser: **um conselheiro que mostra se a família compra
produtos adequados às suas necessidades e sugere trocas mais saudáveis** — sem deixar
de responder ao preço. A mesma coorte responde a *"mais barato"* **e** *"mais saudável"*.

## 2. A fundação já existe: a classificação semântica facetada

Tudo isto assenta no que já construímos. A **coorte facetada** (o Produto Mestre) é o
**motor de "produtos similares"** — sem ela, "trocar por um similar" não tem significado
(sugeriria "come uma maçã em vez do iogurte"). A troca é **dentro da coorte**.

E há uma razão profunda para funcionar: **os gates que definem a identidade são, em
grande parte, os mesmos que definem a nutrição.** `teor=meio-gordo` **é** a gordura;
`gouda` traz um perfil de gordura/sal característico; `grego natural` tem um perfil de
proteína/açúcar próprio. Logo, **classificar bem já É estimar a nutrição bem** — a
classificação facetada é, em si, um **estimador nutricional**.

## 3. Nutrição herdada da CLASSE, não do produto (natureza-B)

O modelo facetado distingue três naturezas de atributo (ver Taxonomia §3):
- **A — do talão:** *o que o produto é* (queijo, gouda, fatiado). A identidade.
- **B — ocultos (nutrição):** açúcar, sal, gordura saturada, fibra, aditivos, **Nutri-Score**, **NOVA** (ultraprocessado). Penduram-se na coorte, vêm de fora.
- **C — derivados:** €/kg, €/100g — e agora também g de açúcar/semana, % ultraprocessado.

A nutrição (B) **atribui-se à CLASSE**: classificado o produto, herda a nutrição típica
da sua coorte. **O EAN é precisão opcional, não a fundação.**

### Três fontes de nutrição da classe, por ordem de precisão
1. **EAN-exato** — este produto foi scaneado. (melhor)
2. **Herdada de um irmão scaneado** — um membro da coorte tem EAN → os outros herdam.
3. **Mediana OFF da categoria** — zero scans, só a classe → estimativa.

O sistema usa **a melhor disponível** e cai graciosamente para a estimativa, **sempre
marcando a fidelidade**.

## 4. Estimativa COM confiança (a dispersão da classe)

A qualidade da estimativa-por-classe **depende muito da categoria** — e o sistema tem
de saber onde a sua estimativa é boa:

- ✅ **Commodities / alimento simples** (leite meio-gordo, iogurte grego natural, gouda, fruta, legumes, carne, arroz): o **tipo manda na nutrição** → variação de marca pequena → **estimativa fiável**.
- ⚠️ **Processados / compostos** (cereais de pequeno-almoço — açúcar de 5 a 40 g/100g!, molhos, bolachas, snacks): a **receita da marca domina** → estimativa fraca, **e é onde a saúde mais importa**.
- 🟢 **Exceção robusta:** o **NOVA (ultraprocessado)** é estável por categoria — "grego natural" é NOVA 1-3 seja de quem for; "cereais açucarados" é NOVA 4. O **"% ultraprocessado" do carrinho estima-se bem sem EAN**.

**Mecanismo:** para uma classe, pede-se ao OFF a **mediana** dos nutrientes **e a
dispersão**. Dispersão estreita → confiança alta. Dispersão larga → "aproximado". A
própria largura da classe diz **onde a herança chega e onde o EAN compensa**.

## 5. O EAN: opcional, por incentivo — nunca por imposição

O talão **não traz o EAN** (e o QR do talão é fiscal, não tem produtos). O EAN vem de
**ler o código de barras** — um passo à parte, **voluntário**. O modelo de incentivo
(o mesmo do Open Food Facts, que foi construído assim): **os utilizadores ajudam a
obter a informação por OPÇÃO, porque ganham algo, não por imposição.**

### As regras que tornam isto bom, não chato
1. **Nunca bloquear no scan** — o conselheiro funciona sempre de estimativas; o scan é um *upgrade*.
2. **Pedir só onde paga** — alta variância da classe **+** relevância de saúde. Em commodities (estimativa apertada), **silêncio**. Em cereais, sim: *"o açúcar aqui pode ir de 5 a 40 g — queres scanear para saberes?"* O pedido é **justificado por valor**.
3. **Recompensa imediata e DELE** — scaneia o que TE importa → resposta precisa para ISSO (Nutri-Score na hora), não "scaneia para o sistema".
4. **O esforço decai, o benefício acumula** — scan **uma vez por produto** → todos os talões futuros com aquela descrição herdam (cache `descrição→EAN→OFF`). O carrinho habitual cobre-se em semanas.
5. **Contribuição também opcional** — devolver ao OFF um produto português em falta beneficia todos e alimenta o bem comum que usamos — mas é escolha do utilizador (são dados a sair).

Efeito secundário ótimo: o EAN **também resolve** a ambiguidade produto/embalagem (o
200 ml e o 6×1L passam a ter EANs distintos, reais).

## 6. O que o conselheiro faz, por nível de fidelidade

| Capacidade | Precisa de | Disponível |
|---|---|---|
| **Tendências do carrinho** (açúcar/sal/gordura sat./% ultraprocessado ao longo dos meses) | categoria-típica | **já** |
| **Nudges de categoria** (*"compra grego natural e junta fruta em vez do de sabores"*) | categoria-típica | **já** |
| **Perfil de saúde do agregado** (diversidade, fruta/legumes vs processados) | categoria-típica | **já** |
| **Troca produto-a-produto** (*"este iogurte tem 12 g açúcar; este, do mesmo tipo e preço, tem 4 g"*) | **nutrição por produto** | precisa de EAN/scan |

A troca específica é a parte mais forte da visão **e** a mais dependente de precisão —
porque distinguir dois goudas exige a diferença entre eles, que a média da classe não
tem. É exatamente aí que o scan-por-valor entra.

## 7. Princípio inegociável: **factual, não clínico**

O sistema é um **assistente de FACTOS nutricionais, não um conselheiro clínico**:
- ✅ **mostra** factos e scores **públicos** (Nutri-Score, NOVA, "menos açúcar/sal/gordura saturada", aditivos), compara produtos, mostra tendências;
- ⚠️ **não diagnostica nem prescreve** para condições ("para a tua diabetes come X"). Para necessidades de saúde reais, **remete para o médico/nutricionista**, não os substitui.

Isto não é timidez — é o que torna o produto **credível e seguro**. O sistema *informa*;
a pessoa (com o seu profissional) *decide*. Os **dados de saúde são sensíveis**: ok para
a própria família num lab; **exige cuidado redobrado se escalar** (consentimento, isolamento).

## 8. Reusar standards — não reinventar

A classificação facetada que andámos a desenhar **já existe e é madura**. Em vez de
inventar gates por categoria para sempre, **alinhar com**:
- **LanguaL** (FDA) — descrição facetada de alimentos; as facetas **são** os nossos gates: B=fonte, C=corte, E=apresentação/forma, F/G=cozedura, **J=conservação/cura**, **K/M=embalagem**, **P=claims (bio/light/lactose)**, **R=origem/DOP**. Cobre **inclusive os gates que nos faltavam**.
- **FoodOn** — a versão viva, legível por máquina (OWL/OBO, URIs estáveis); integra a LanguaL.
- **Open Food Facts** — a camada **prática**: taxonomia de categorias multilingue (PT), **Nutri-Score, NOVA, nutrientes, aditivos** por EAN, e o **Robotoff** (predição de categoria por API).

O **LLM** continua no **último quilómetro** (talão PT terse → facetas), mas deve **emitir
valores LanguaL + categorias OFF** — dados alinhados ao standard, interoperáveis. Quando
houver EAN: `EAN → OFF → FoodOn`, sem ambiguidade.

## 9. Os senões honestos (importam, não bloqueiam)

1. **Comprado ≠ consumido.** O talão diz o que entrou em casa, não o que cada um comeu (desperdício, partilha). Ao longo de meses é um **proxy forte** do padrão do agregado — mas é proxy, não ingestão clínica.
2. **Estimativa fraca nos processados** — exatamente onde a saúde mais importa; mitigada pelo scan-por-valor e pelo NOVA (robusto).
3. **Disponibilidade das trocas** — só se sugere o que existe nas lojas onde compram; mais fiável dentro do histórico deles; sugerir um produto novo precisa de catálogo de loja.
4. **Arranque a frio** — no início quase tudo é estimativa (e tudo bem); os scans de alto valor acumulam com o tempo.
5. **Quem nunca scanear** continua com um conselheiro completo **ao nível de categoria**.

## 10. A visão, de uma ponta à outra

> **classificação semântica facetada** (identidade)
> → **nutrição herdada da classe** (natureza-B, via OFF)
> → **estimativa com confiança pela dispersão da categoria**
> → **EAN opcional, pedido por valor onde a classe é larga** (scan voluntário)
> → **cache `descrição→EAN→OFF` + give-back à comunidade**
> → **conselheiro factual** (tendências, nudges, trocas), **nunca clínico**.

A mesma máquina que construímos para o preço serve a saúde. O que falta não é
arquitetura — é (a) **pendurar a nutrição na coorte** (OFF, com confiança), (b) o
**fluxo de scan opcional** com o cache, e (c) **alinhar a classificação aos standards**.

### Sequência sugerida (quando voltarmos ao código)
1. Alinhar a classificação ao **OFF/LanguaL** (categorias + facetas) — base de tudo.
2. **Nutrição-por-classe** via OFF (mediana + dispersão) → tendências e nudges (nível categoria) **já entregáveis**.
3. **Fluxo de scan opcional** (câmara → EAN → OFF) + cache `descrição→EAN` → desbloqueia a troca produto-a-produto e a precisão onde importa.
4. **Conselheiro** sobre isto, com o princípio **factual-não-clínico** embutido.

## Fontes
- LanguaL — <https://www.langual.org/> · FoodOn — <https://foodon.org/>
- Open Food Facts — <https://world.openfoodfacts.org/> · Robotoff — <https://openfoodfacts.github.io/robotoff/>
- Nutri-Score · NOVA (classificação de processamento alimentar)

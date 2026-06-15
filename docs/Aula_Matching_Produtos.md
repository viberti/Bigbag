# Como o BigBag identifica produtos — sobretudo quando NÃO há código de barras

*Documento didático (≈4 páginas) para apresentação em turma de graduação.
Companheiro de `Aula_Classificacao_Produtos.md` (essa explica como ARRUMAR um
produto; esta explica como SABER qual ele é). Derivado de `Normalizacao.md`,
`Analise_Fontes_Normalizacao.md`, `Schema_e_Funcoes_ToolUse.md` e do código real
(`normaliza/`, `ingest/`) — snapshot de 2026-06-15; não é fonte de verdade.*

---

## 1. O problema: o código de barras é o fácil — e muitas vezes não está lá

Quando há **EAN** (o código de barras), identificar é quase trivial: o EAN é uma
chave global única. Lê-se, valida-se o dígito verificador, e consulta-se uma
base por essa chave. Acabou.

O difícil é o resto — e o resto é a maioria. Num talão real de teste (657 itens,
463 descrições distintas, 6 cadeias), **só ~28% das linhas traziam EAN** (Makro,
Continente recente). As outras ~72% chegam assim:

```
LEIT MG UHT PD200ML          ← Pingo Doce não imprime EAN na linha
IOG GREGO LIGEIRO PD 4X120
BOL DIGESTIVE AVEIA CNT 425GR
BANANA                       ← fresco: nunca terá EAN útil
```

E há ainda dois casos sem texto de talão nenhum:
- O utilizador **fotografa um produto** e o leitor de barras falha (luz, rótulo
  amassado) ou o EAN simplesmente **não está em nenhuma base** (marca-própria nova).
- O EAN é **lido mas errado**: o VLM troca um dígito e produz *outro EAN real*
  (passa no dígito verificador!).

> **A tese desta aula:** sem EAN, a identidade não vem de uma consulta — **constrói-se
> juntando evidência** (texto, marca, tamanho, sabor, preço, imagem) até a confiança
> chegar a um limiar. É *resolução de entidades*, não *lookup*.

---

## 2. As fontes — o que temos para casar contra

Identificar é casar a coisa que chega contra **alguma fonte que já conhecemos**.
O sistema tem várias, com coberturas e papéis diferentes:

| Fonte | Tamanho | Tem EAN? | Papel no matching |
|---|---|---|---|
| **`catalogo_produto`** | ~46,6k | Auchan+Continente sim (~31k); Pingo Doce/Lidl-PT **não** | catálogos de loja scrapados; o terreno onde a maioria dos talões PT casa |
| **`off_produto`** (dump OFF) | ~27k | sim | snapshot local do Open Food Facts; nutrição/ingredientes por EAN, sem rate-limit |
| **`off_full`** (OFF completo) | **~4,5M** | sim (PK) | baixado 2026-06-15; nutrição (2,2M) + **imagem** (3,3M) por EAN; o backstop universal |
| **`produto_busca`** | ~54k | sim | índice **FULLTEXT** do catálogo PT-comprável (lojas PT + ES/FR traduzidos); busca por nome |
| **`produto_ean`** | mestre por EAN | sim | a ficha fundida (cap. 1 da outra aula); o que já resolvemos fica aqui |
| **`produto_generico`** | ~288 | n/a | frescos caracterizados por nome (banana, fraldinha) → nutrição por classe |
| **Qdrant `produtos_img`** | ~36k vetores | via EAN | **embeddings de imagem** (CLIP) — casar por aparência |
| **OFF API live** | — | sim | último recurso por EAN; resultado é gravado no dump (self-heal) |

Repare na assimetria que comanda tudo: **`off_full` tem 4,5M de produtos mas é
multilíngue** (PT < 1% dos nomes), logo serve **por EAN** (chave), não por nome.
A busca **por nome** vive no `produto_busca` (~54k, só o que se vende cá, já em PT).
Fonte gigante para confirmar uma chave; fonte pequena e limpa para procurar texto.

---

## 3. A regra de ouro: determinístico primeiro, LLM como juiz no fim

Antes dos caminhos concretos, a arquitetura que todos partilham. Cada caminho é um
**funil**: começa barato e determinístico (filtra muito candidato por cêntimos de
custo), e só no fim, sobre os poucos finalistas, gasta um LLM para **confirmar** —
nunca para procurar do zero.

```
 muitos candidatos ──[ filtros determinísticos: tokens, marca, sabor, formato ]──►
 poucos finalistas ──[ pontuação ]──► 1 forte?  ──sim──► aceita (zero LLM)
                                              └──não──► juiz LLM confirma  ──► aceita / "por identificar"
```

Porquê esta ordem: o determinístico é **rápido, grátis e auditável** (sabes qual
regra disparou); o LLM é caro e opaco, mas insubstituível para desambiguar
linguagem ("creme de limpeza" é o produto genérico ou a marca *Creme*?). Usá-lo só
no fim, sobre 8 finalistas em vez de 50 mil, é o que torna a ingestão viável.

---

## 4. Caminho 1 — match por TEXTO (a linha de talão sem EAN)

O caso mais comum. Entra `"IOG MYTHOS CNT EQ NAT LIG"`; tem de sair *Iogurte Grego
Mythós Natural Ligeiro, Continente*. Módulo: `normaliza/resolverProduto.js`.

**Passo a passo do funil:**

1. **Expandir abreviaturas** (`abreviaturas.js`) — `IOG`→`Iogurte`, `NAT`→`Natural`.
   As ~14 abreviaturas foram **mineradas dos próprios pares já validados**, não
   escritas à mão; as ambíguas ficam marcadas (`NAT = Natural | Natas`).
2. **Pesar tokens por raridade (IDF).** Numa descrição, nem toda a palavra vale o
   mesmo: `"mel"` aparece em centenas de produtos (pouco informativo); `"rosmaninho"`
   aparece em três (quase identifica sozinho). O sistema dá **mais peso aos tokens
   raros** e à **posição** (a 1ª/2ª palavra costuma ser o substantivo-cabeça).
3. **Procurar candidatos pelos tokens mais raros** (`candidatosCatalogo`) — vai
   buscar ao catálogo os EANs cujos nomes cobrem os tokens de maior peso do talão.
4. **As "portas" (gates) — rejeição é tão importante como atração:**
   - **Porta de marca:** se o talão diz a marca, o candidato tem de a ter — toda.
   - **Porta de sabor/faceta:** morango **nunca** casa com baunilha
     (`saborConflito`), mesmo que tudo o resto bata.
   - **Porta de preço:** um preço grosseiramente fora (>5×) mata o candidato.
   - **Códigos "2…":** EANs internos de loja (peso variável) são despriorizados.
5. **Pontuar e decidir** (`resolverProduto`): se o melhor candidato pontua forte
   (≥0,6) e destaca-se do 2.º, aceita **sem LLM**. Senão, ou se houver risco de nome
   genérico, o **juiz LLM** vê os 8 finalistas e responde "qual é exatamente o mesmo
   produto?". Sem candidato firme → a linha vai para a worklist **"por identificar"**
   (203 descrições, no talão de teste) para o operador resolver à mão.

> **Armadilha real:** o preço só **confirma** (o tamanho bateu → é este formato),
> nunca **escolhe**. Catálogo online é referência, jamais critério — o preço-facto
> é sempre o do talão.

---

## 5. Caminho 2 — match por NOME contra o OFF (foto, EAN desconhecido)

O utilizador fotografa um produto; o EAN não foi lido ou não existe em lado nenhum.
O VLM lê o **nome e a marca** do rótulo. Agora procuramos o **mesmo produto sob
OUTRO EAN** no `off_full`. Módulo: `normaliza/resolverPorNome.js` (`acharPorNomeMarca`).

```
foto ─► VLM ─► "Pérolas Hacendado 250 g"
                     │
                     ▼   FULLTEXT(nome, marca) no off_full (4,5M)
        +perolas* +hacendado   ← marca = +obrigatória (gate forte)
                     │
                     ▼
        EAN 8402001019890 · Pérolas · Hacendado · 250 g · nutrição + imagem
```

Três regras que o tornam fiável:
- **A marca é gate forte** (`+marca` obrigatório no FULLTEXT) — sem ela, "natural"
  casaria meio supermercado.
- **O tamanho desempata** (±10%): entre dois Hacendado, ganha o de 250 g.
- **Quando o nome É a marca** (Nutella, Coca-Cola) e não sobram tokens de produto,
  busca-se pela própria marca.

Resultado importante: isto **nunca é facto do EAN exato**. O EAN fotografado
continua desconhecido; o que ganhámos foi *"é o mesmo produto que este outro EAN
conhecido"* — uma ponte para herdar nutrição e imagem. Por isso pede-se confirmação.

---

## 6. Caminho 3 — match por IMAGEM (a foto valida o que o texto achou)

Texto pode mentir (OCR troca letras, nomes genéricos colidem). A imagem é uma
segunda testemunha independente. Módulo: `normaliza/matchImagem.js`.

- Um serviço de inferência (`bigbag-infer`, modelo **CLIP**) transforma a foto num
  **vetor** de 512 dimensões — uma "impressão digital" visual.
- Esse vetor procura-se numa base vetorial (**Qdrant**, coleção `produtos_img`,
  ~**36k** produtos já vetorizados) por **vizinhança de cosseno**: as fotos mais
  parecidas vêm no topo, com um score [0..1].
- Como um produto tem várias fotos, **agrega-se por EAN** (o melhor score de cada).

A visão que une os caminhos 2 e 3: **o texto acha o candidato, a imagem confirma-o.**
Quando os dois concordam (o nome do OFF e a aparência apontam o mesmo EAN), a
confiança é alta; quando divergem, pede-se ajuda humana. E cada foto confirmada
**vetoriza-se e entra no índice** — o sistema fica melhor a cada uso.

---

## 7. Caminho 4 — frescos: não há código, a identidade é o nome

Banana, fraldinha, salsa ao molho. Não têm EAN útil e não estão em catálogo de
loja com tabela nutricional. Módulo: `ingest/produto.js` (`garantirGenericoSku`).

A identidade é o **nome genérico**, e a nutrição vem da **classe**, não do produto:
"banana" tem ~89 kcal/100 g *por natureza*, independentemente de quem a vendeu. Um
LLM caracteriza o nome uma vez (`tipo: fresco | básico | processado`, categoria,
nutrição típica), o resultado fica **em cache** (`produto_generico`), e nunca mais
se chama o LLM para aquele genérico. Nota fina: a nutrição-por-classe só se atribui
a *fresco/básico* (commodities de tabela); um *processado* sem rótulo fica honesto
com nutrição vazia.

---

## 8. Caminho 5 — catálogo↔catálogo: dar EAN a quem não tem

O Pingo Doce publica catálogo (~15k produtos) **sem EAN**. Mas muitos desses
produtos são os **mesmos** que o Auchan/Continente vendem *com* EAN. Então
casa-se **catálogo contra catálogo** — pela mesma maquinaria de tokens+marca do
caminho 1, com cobertura ≥80% e marca obrigatória — e **herda-se o EAN** do par.
Resultado real: **2.562 EANs inferidos** para o Pingo Doce.

> **Cuidado registado:** o EAN inferido é **referência, não identidade** — o Pingo
> Doce não imprime tamanho, então a inferência pode acertar o produto mas não o
> formato. Entra como pista, nunca como facto do histórico de preços.

---

## 9. O quadro completo — qual caminho, quando

```
                    ┌─────────────────────────── chega um produto ───────────────────────────┐
                    │                                                                          │
              tem EAN legível?                                                          é fresco?
                /        \                                                              /       \
             sim          não                                                        sim        não
              │            │                                                          │          │
       consultarOFF    veio de…                                              nome → classe   (segue p/ matching)
       + fundirFicha   /        \                                          (produto_generico)
       (chave única)  talão     foto
                       │          │
                 Caminho 1    Caminho 2 (nome→OFF) + Caminho 3 (imagem)
                 (texto)      texto acha, imagem confirma
                       │          │
                  Caminho 5 (catálogo↔catálogo dá EAN ao que não tinha)
```

Os caminhos **não são exclusivos** — reforçam-se. Uma foto de talão sem EAN pode
passar pelo texto (caminho 1) *e* pela imagem (caminho 3); um EAN inferido
(caminho 5) alimenta a ficha por EAN (a outra aula). A identidade emerge do
**acordo entre fontes**, não de uma só.

---

## 10. A lição de arquitetura (para levar para casa)

> **Sem chave, a identidade é um acúmulo de evidência fraca, não um lookup.** Nenhum
> sinal sozinho resolve: o texto erra, a marca falta, a imagem confunde embalagens
> parecidas. Mas **vários sinais fracos e independentes que concordam** dão uma
> resposta forte — e, onde não concordam, o sistema sabe que não sabe e pergunta.

Três princípios que esta aula concretiza:

1. **Funil barato→caro.** Determinístico filtra os milhares; o LLM confirma os
   oito. Inverter a ordem (LLM a procurar do zero) é o erro que torna a ingestão
   impagável.
2. **Rejeitar é meio trabalho.** As "portas" (marca, sabor, preço-disparate) eliminam
   tanto candidato quanto a pontuação atrai. Um bom matcher é tão bom a dizer *não*
   como a dizer *sim*.
3. **O índice cresce com o uso.** Cada match confirmado — um EAN inferido, uma foto
   adotada, um genérico cacheado — fica guardado e torna o próximo mais fácil. **O
   ativo não é a base de dados; é o mecanismo que a faz crescer sozinha, com correção
   humana só onde duvida.**

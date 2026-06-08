# Resolução de Entidades de Produtos a partir de Talões de Supermercado: Taxonomia Facetada, Normalização e Correspondência de Descrições Incompletas

> **Relatório técnico — Projeto Bigbag.** Última revisão: 2026-06-08.
> Documento de engenharia/investigação. Sem segredos, credenciais nem dados pessoais.
> Documentos irmãos: [`Taxonomia_Produto.md`](Taxonomia_Produto.md) (modelo-alvo facetado),
> [`Normalizacao.md`](Normalizacao.md) (estado de implementação), [`Schema_e_Funcoes_ToolUse.md`](Schema_e_Funcoes_ToolUse.md).

## Resumo

Apresentamos o procedimento usado para transformar **linhas de talão de supermercado** — texto abreviado, ruidoso e sem código de barras — em **entidades de produto canónicas e comparáveis** ao longo do tempo e entre cadeias. O método combina três ingredientes: (i) um **modelo de identidade facetado** ("Produto Mestre") ancorado em standards abertos (Open Food Facts, GS1 GPC, IFPS PLU), que distingue *portões* (gates, atributos mantidos constantes para comparar) de *dimensões* (eixos sobre os quais se compara); (ii) um **pipeline híbrido** determinístico-primeiro com um modelo de linguagem (LLM/VLM) confinado às tarefas em que só ele é bom (interpretar texto livre, ler imagem); e (iii) uma disciplina de **sinais honestos de incerteza** — valores incomputáveis ficam nulos e sinalizados, em vez de fabricados. O núcleo do problema — casar uma descrição *incompleta* (`GREGO NATURAL`) com o produto certo (`Iogurte Grego Natural`) — é resolvido por uma cascata de correspondência (cache de alias → canonicalização por LLM → similaridade determinística → juiz LLM) e por uma **chave canónica determinística** construída sobre facetas extraídas, não sobre a string do nome. Relatamos observações empíricas numa amostra pequena (utilizador único, 58 talões, ~600 itens, 6 cadeias): a chave determinística atinge agrupamento perfeito em dados limpos transversalmente a cinco modelos de fronteira, e a reconciliação aritmética fecha em quase todas as notas após re-leitura com o pipeline atual.

**Palavras-chave:** resolução de entidades, normalização de produtos, taxonomia facetada, OCR/VLM, modelos de linguagem, preços de retalho, dados sujos.

---

## 1. Introdução

O objetivo aplicado é simples de enunciar e difícil de cumprir: dado o histórico de compras de uma pessoa — capturado fotografando ou importando talões — responder a perguntas como *"onde está mais barato o leite?"* ou *"a banana subiu de preço?"*. Para isso, duas sub-tarefas têm de ser resolvidas a partir de cada **linha** de talão:

1. **Identidade canónica** — reconhecer que `BOL DIGESTIVE AVEIA CNT 425GR` (cadeia A), `DIGESTIVE AVEIA` (cadeia B) e `Bolacha Digestive` denotam **o mesmo produto**.
2. **Preço comparável** — exprimir o preço numa base comum (€/kg, €/L ou €/unidade), para que formatos diferentes (250 g vs 1 kg; pack de 6 vs avulso) caiam na mesma escala.

A entrada é hostil de uma forma característica deste domínio: descrições **abreviadas e truncadas** pela largura do papel térmico; **erros de leitura** (OCR/VLM) sobre impressão de baixa qualidade; **convenções divergentes por cadeia** (posição do código de IVA, separador de multipack, peso impresso ou omitido); marcas que aparecem ou não; acentuação errática; e **ausência de identificador estável** (não há EAN nas linhas). É, na prática, um problema de *entity resolution* sobre texto sujo, agravado por não existir uma chave a que ancorar.

A nossa contribuição não é um algoritmo novo isolado, mas um **procedimento integrado e reprodutível** com três escolhas de desenho que se reforçam:

- **Modelo facetado de identidade** que separa o que *define* o produto do que *varia* nele (§4);
- **Chave determinística sobre facetas** — o LLM extrai facetas; a chave estável é montada em código, o que torna o agrupamento robusto ao não-determinismo do modelo (§4.3, §6.3);
- **Incerteza explícita** — quando o dado não está na fonte, o sistema marca-o (`null` + flag) em vez de inventar, preservando a integridade das comparações (§7).

## 2. Formulação do problema

Seja um talão um documento $D$ com metadados (loja, data, total) e uma lista de linhas $\{\ell_i\}$. Cada linha $\ell_i$ traz uma **descrição** $d_i$ (texto), uma **quantidade**, um **preço de linha**, e — por vezes — um **peso** e um **preço unitário impresso**. Pretende-se uma função

$$ \Phi(\ell_i) \mapsto (s,\; p^{\text{base}}) $$

que atribui a cada linha um **produto canónico** $s$ (de um conjunto materializado $\mathcal{S}$, construído incrementalmente) e um **preço por base** $p^{\text{base}}$ comparável. As dificuldades dividem-se em três famílias, cada uma tratada por um bloco do procedimento:

| Família | Exemplo | Tratada em |
|---|---|---|
| **Formato/preço** | peso omitido; multipack `6*1L`; €/kg em ordem invertida | §5.3–5.4 |
| **Identidade** | `GREGO NATURAL` ↔ `Iogurte Grego Natural`; "Maçã Gala" com/sem marca | §4, §6 |
| **Documento** | mesma nota lida duas vezes com loja/data mal lidas | §8 |

## 3. Fundamentação: standards abertos

Em vez de inventar uma taxonomia *ad hoc*, ancoramos o modelo em três standards públicos e complementares, usados como **vocabulário e estrutura**, não como dependência em tempo de execução:

- **Open Food Facts (OFF)** — taxonomia de categorias em grafo acíclico dirigido (DAG), multilingue, com sinónimos. Fornece a **categoria fina** (banana, não "fruta") e a cadeia de hiperónimos. Verificámos empiricamente a coerência de cadeias relevantes (p. ex. *greek-yogurt*) e a separação de ramos (produtos vegetais como ramo distinto).
- **GS1 GPC (Global Product Classification)** — *bricks* estáveis (p. ex. *Yogurt*) úteis como âncora grosseira e ponte para dados industriais.
- **IFPS PLU** — códigos de produtos frescos (fruta, hortícolas, arroz por variedade) — pertinentes precisamente onde não há EAN.

A lição central é que **uma chave plana universal falha**: os atributos que distinguem dois produtos dependem da categoria (em carne: animal+corte+processamento; em queijo: denominação+apresentação+fonte; em iogurte: estilo+sabor+teor). Os standards dão-nos a estrutura por categoria.

## 4. Modelo: o Produto Mestre facetado

### 4.1 Três naturezas de atributo

Distinguimos os atributos pela sua **proveniência e estabilidade**:

- **Natureza A — textuais/parse**: inferíveis da descrição do talão (categoria, sabor, teor, apresentação, variedade). São **estáveis** e formam a identidade.
- **Natureza B — ocultos**: só obteníveis por uma fonte externa (açúcar, proteína, bio, lactose) — tipicamente via EAN→OFF. São **descritivos**, nunca entram na chave.
- **Natureza C — derivados**: computados (preço por base, €/100 g).

A regra de ouro: **B é descritivo, nunca chave**. Se o teor-de-EAN entrasse na chave, ligar um EAN mais tarde **re-particionaria** o histórico — inadmissível. A identidade tem de ser construível a partir do que está no talão (A) e enriquecida (B) sem se partir.

### 4.2 Portões *vs* dimensões; a coorte

O critério operacional que organiza o modelo:

- **Portão (gate)** — atributo que se **mantém constante** para que a comparação faça sentido (sabor, teor, forma, apresentação, variedade, fonte). Iogurte de morango e de coco **não** se comparam: o sabor é portão.
- **Dimensão** — eixo sobre o qual se **compara** (marca, gama, dose/formato). "Qual marca de iogurte grego natural é mais barata?" compara *sobre* a marca, mantendo *fixos* estilo+sabor+teor.

A **coorte** de uma consulta de preço é exatamente o conjunto de específicos sob um mesmo Mestre: o Produto Mestre **é** a coorte materializada.

### 4.3 Chave de identidade determinística

A peça que se revelou *load-bearing*. Em vez de agrupar pela string do nome (frágil) ou diretamente pelas facetas cruas do LLM (não-determinísticas), construímos uma **tupla canónica** sobre os portões da categoria:

```
chave = categoria | apresentacao | corte | processamento | variedade
        | sabor | teor | estilo | funcao | fonte
```

com três disciplinas determinísticas aplicadas em código (não no prompt):

1. **Normalização de valores** por dicionário e contexto: `M/G`, `MG`(leite), `meio gordo`, `semi` → `meio-gordo`; `0%`, `magro`, `light`, `ligeiro` → `magro`. O caso `MG` vs `M/G` prova que a normalização é **dependente da categoria** (o mesmo token difere).
2. **Defaults de portão (ausente-vs-diferente)**: um valor que é o *default* da categoria **não** deve discriminar. `fonte = vaca` colapsa para vazio num lácteo (vaca ≡ não-especificado), senão partiria o Mestre.
3. **Canonicalização de denominação** quando a categoria tem vocabulário fechado. Exemplo concreto: o queijo. O LLM coloca a denominação de forma inconsistente (ora `categoria="queijo gouda"`, ora `variedade="gouda"`, ora perde-a, ora muda a ortografia `mozarela`/`mozzarella`). Nenhum ajuste de prompt o estabiliza. A solução é uma camada determinística que, **seja qual for a saída do LLM**, normaliza para `categoria=queijo + variedade=<denominação canónica>`, com mapa de ortografia, remoção de menções DOP/IGP do nome e exceções com categoria própria (requeijão, burrata, ricotta).

A separação de responsabilidades — **o LLM extrai, o código decide a chave** — é o que torna o agrupamento reprodutível.

### 4.4 Unidade pela categoria

A base de comparação (kg/L/un) é uma propriedade do **produto**, não da linha. Fruta a peso compara-se por kg mesmo que numa compra específica o talão não imprima o peso. A unidade é decidida deterministicamente (peso/volume explícito no formato ganha ao palpite do LLM), com guardas para categorias contadas (ovos — onde `53-63G` é o calibre, não o pacote) e para peças cortadas a peso ("mamão partido" → kg, ver §7).

## 5. Pipeline de processamento

```
imagem/PDF → (1) extração estruturada → (2) reconciliação aritmética
           → (3) limpeza da descrição → (4) preço por base
           → (5) correspondência →  produto canónico + €/base
```

### 5.1 Extração estruturada (VLM/LLM)

Cada documento é lido para **JSON estruturado**. Para **imagens** usa-se um modelo multimodal (VLM) diretamente; para **PDFs digitais** extrai-se o texto e usa-se um LLM textual — uma comparação *head-to-head* mostrou que, em fotografias, o VLM-direto reconcilia muito melhor do que OCR clássico seguido de LLM (o OCR de foto induz o LLM a *alucinar* a partir do ruído).

Decisão de desenho relevante: o esquema do item pede **campos próprios** para o que é estruturado — nome, quantidade, **`peso_kg`**, **`preço por kg impresso`**, taxa de IVA, e o **`ean`** quando a linha o traz (cash-and-carry, §6.4) — em vez de deixar o modelo colar peso, preço ou código no nome. Isto entrega o **nome limpo na origem**, o €/kg directamente do talão e o EAN da linha já isolado, eliminando pós-processamento por expressão regular.

### 5.2 Reconciliação aritmética (verificação embutida)

A qualidade da leitura é **auto-verificável**: $\sum_i \text{preço}_i - \text{desconto global} \stackrel{?}{=} \text{total impresso}$. Quando não fecha, um **loop de auto-correção limitado** realimenta o modelo com a discrepância (e pistas cirúrgicas sobre a linha inconsistente), ficando-se com a melhor tentativa. A discrepância residual é gravada como **métrica de qualidade por nota**; notas que não fecham são marcadas `needs_review` e excluídas das análises de preço.

### 5.3 Limpeza determinística da descrição

Mesmo com extração estruturada, descrições legadas e variações trazem ruído: prefixos de quantidade (`1 `), códigos de IVA (`(A)`, `C `), e peso/preço colados (`BANANA B kg x1,056 1,19 EUR/kg`). Uma função idempotente remove este ruído **preservando o peso** numa coluna à parte antes de o retirar do nome — porque o peso é a fonte do €/kg. Detalhe não-óbvio mas crítico: o ruído **quebrava o cache de correspondência**. Como o peso varia a cada compra, usar a linha crua como chave de cache fazia o *mesmo* produto nunca reutilizar a sua entrada. Limpar a descrição **antes** de a usar como chave restaura o cache.

### 5.4 Preço por base (€/kg, €/L, €/un)

Um parser determinístico extrai formato/peso/contagem e calcula o €/base, do padrão mais específico ao mais geral (peso+€/kg impresso; peso sem unidades; €/kg em qualquer ordem; multipack `4X115G`/`6*1L`; formato simples `425GR`; contagens/dúzias/ovos). O cálculo respeita a **unidade autoritativa do produto**. Quando o alvo é peso/volume mas a descrição não traz peso, devolve **`null`** (incomputável honesto) — nunca um €/embalagem enganador (ver §7).

## 6. Correspondência descrição → produto (o núcleo)

Esta é a pergunta central do utilizador: *como, a partir de `GREGO NATURAL`, chegar a `Iogurte Grego Natural`?* A resposta é uma **cascata determinística com um passo LLM opcional**, desenhada para que a esmagadora maioria das linhas se resolva instantaneamente e o modelo só seja chamado para o que é genuinamente novo.

### 6.1 A cascata

```
resolver(descrição d):
  d ← limparDescrição(d)                       # chave estável (§5.3)
  1. se existe alias[d] → devolve sku (cache, O(1), determinístico)
  2. c ← canonicalizar_LLM(d, contexto=cadeia) # nome s/ marca/formato, marca, categoria, unidade, confiança
     se confiança(c) < τ_baixo → devolve (sem-sku, p/ revisão)
  3. candidatos ← SKUs com mesma marca ∧ mesma unidade ∧ formato compatível
  4. (cand, score) ← melhor por similaridade(nome(c), candidatos)
  5. decisão por limiares:
        score ≥ τ_auto (0.85)         → match
        τ_rev ≤ score < τ_auto        → juiz_LLM confirma sim/não
        score < τ_rev (0.6)           → cria SKU novo
     exceção: nome canónico idêntico (normalizado) reutiliza sempre o SKU
  6. grava alias[d] ← sku (com confiança por via)  # aprende para a próxima
```

Três propriedades merecem nota:

- **Cache que aprende.** O passo 6 transforma cada resolução (humana ou automática) numa entrada de cache; as descrições repetem-se imensamente, pelo que o sistema converge para resolução O(1) determinística e o LLM corre cada vez menos.
- **Confiança por via, durável.** O grau de certeza do mapeamento (manual/fusão = 100, match = 90, juiz = 75, SKU novo = 60) é gravado **no alias**, sobrevivendo a reprocessamentos. Alimenta uma *worklist* de revisão ordenada do pior para o melhor — curadoria dirigida por dados, não caça aleatória.
- **Marca como filtro duro** acelera e isola, mas introduz uma tensão (§10): como o nome canónico é *brand-agnostic*, o mesmo produto com/sem marca pode fragmentar — mitigado por auto-fusão de nomes idênticos.

### 6.2 Similaridade

A pontuação de nomes é o **coeficiente de Dice sobre tokens normalizados** (acentos e maiúsculas removidos, *stopwords* fora), reforçado por inclusão de subconjunto — robusto a abreviaturas e a ordem de palavras. É determinístico e barato; o LLM só arbitra a zona cinzenta $[\tau_{\text{rev}}, \tau_{\text{auto}})$.

### 6.3 Da descrição incompleta à coorte: a chave facetada

A correspondência por *nome* (§6.1) resolve a ligação ao SKU de marca; a ligação à **coorte comparável** (o Mestre, §4) usa a **chave facetada** (§4.3). Aqui está a razão de a descrição incompleta funcionar: `GREGO NATURAL`, `IOG GREGO NAT PD 1KG` e `Iogurte Grego Natural` produzem, após limpeza + extração de facetas + montagem determinística da chave, a **mesma tupla** `iogurte|...|natural|...|grego|...` — independentemente de marca, formato, ortografia ou de quão truncada vinha a linha. A incompletude da descrição deixa de importar desde que as **facetas-portão** sejam recuperáveis (e quando não são, o slot fica vazio e o item liga a um Mestre *provisório* "faceta-desconhecida", candidato a promoção quando uma fonte a resolver).

Validámos que é a **chave estável**, e não o modelo, que decide o agrupamento: com a mesma limpeza e a mesma chave canónica, cinco modelos de fronteira distintos produziram agrupamento idêntico (F1 = 1.0) sobre dados limpos. A chave leve (sem normalização) sobre-une ou parte; a canonicalizada agrupa corretamente.

### 6.4 Identificação por EAN — a âncora forte, quando existe

Embora a linha de talão *normalmente* não traga código de barras (§2), há três vias para obter um EAN, que quando disponível **resolve a identidade sem ambiguidade** (ancora à embalagem exata e abre a porta ao enriquecimento OFF, §7-bis no documento de visão):

1. **Scan do código de barras** — leitura ao vivo pela câmara (biblioteca `zxing` no cliente), o caminho preferido e mais fiável.
2. **Foto do EAN** — quando o scanner ao vivo falha (telemóvel antigo, código danificado), uma foto do código é lida por VLM (`lerEanDeFoto`); o resultado passa pela mesma validação.
3. **EAN da própria linha do talão** — em **cash-and-carry** (Makro e afins), a primeira coluna de cada linha é o "Nº Código Artigo" = um EAN-13. A extração captura-o num campo próprio (`ean` por item) e ele persiste na linha (`item.ean`), identificando o produto **sem foto nem scan**.

**Validação por dígito verificador.** Todo o EAN — leia-se por que via for — passa por uma verificação determinística do **dígito de controlo GTIN** (`eanValido`, válida para EAN-8/UPC-12/EAN-13/GTIN-14, *offline*). Isto **apanha a maioria das leituras erradas** (uma troca de um dígito quase nunca mantém o *checksum*) antes de poluir a base com produtos-fantasma; um EAN que falhe o dígito é descartado e o item volta ao estado "por identificar".

**Caveat honesto — o EAN válido-mas-errado.** O dígito verificador é necessário, não suficiente: um VLM pode ler um EAN **diferente do real mas ainda assim válido**. Caso observado: papel higiénico cujo código foi lido como `…540` em vez de `…560` — ambos passam o *checksum* (a fórmula do dígito é, por construção, o que torna *qualquer* sequência válida ao ajustar o último dígito). A mitigação é **cruzar o EAN com a descrição do talão / o nome OFF**: se o produto que o EAN devolve não casa com a linha, sinaliza-se em vez de aceitar cegamente. Esta é uma fronteira ativa do método.

**Autoridade do EAN do talão.** Quando o mesmo item tem um EAN vindo do talão **e** um EAN identificado à mão (foto/scan), o **do talão sobrepõe-se** — é o que o documento fiscal afirma sobre aquela compra concreta, logo a fonte mais autoritativa para ligar a linha ao produto.

### 6.5 Modelo de três níveis de nome

A par da chave facetada (que decide a coorte) e do nome canónico *brand-agnostic* (§6.1), o sistema mantém uma **hierarquia de nomes** que serve propósitos distintos, alimentada por todas as fontes (talão, rótulo via VLM, OFF — por vezes noutra língua):

- **Nível 1 — nome do talão** (`descricao_original`): cru, abreviado, por cadeia. A entrada.
- **Nível 2 — nome do produto real**: o nome legível da embalagem/OFF (com marca), recolhido na identificação por EAN.
- **Nível 3 — nome normalizado genérico** (`nome_canonico`): a **família** sem marca nem formato ("Iogurte Grego Natural", não "… Mythos"), que serve produtos de várias lojas.

Em torno disto, dois artefactos: **`produto_nome`** acumula *todas* as variantes vistas para um EAN (de qualquer fonte/língua) — matéria-prima para *matching* e para compor o canónico; e **`nome_sugestao`** guarda uma **sugestão de nome canónico** gerada por LLM dessas variantes (`sugerirNomeCanonico`), para o operador rever e aplicar/rejeitar. O nome genérico é, deliberadamente, *brand-agnostic*; os nomes de nível 1–2 ricos em variantes existem para o *matching* não perder ligações.

## 7. Incerteza honesta

Um princípio transversal: **não fabricar números que a fonte não dá.** Três manifestações:

- **Preço por base incomputável.** Para um produto a peso cujo talão não imprime o peso (comum em cadeias de desconto, que imprimem só o preço da peça pré-cortada), `preço por base = NULL` e o item é marcado **`peso_em_falta`** — fica fora das comparações €/kg, mas o preço pago e a data permanecem no histórico. A alternativa (assumir 1 kg, ou tratar o preço da peça como €/kg) introduziria valores enganadores. Caso ilustrativo: "mamão partido" — peça cortada de tamanho variável, vendida a preço fixo sem kg impresso; o €/kg é **estruturalmente irrecuperável** e o sistema assume-o.
- **Recuperação só quando legítima.** Para **packs de peso fixo** (p. ex. mirtilo 500 g), em que o tamanho é uma propriedade do produto e não há pesagem ao balcão, o €/kg deriva-se do tamanho do pacote (`preço / tamanho`), com guardas que **excluem** itens pesados ao balcão e multipacks — evitando reintroduzir o engano.
- **Produto desconhecido.** Quando a descrição não contém um produto reconhecível (ruído, item não-mercearia), a canonicalização **baixa a confiança** e o item fica para revisão, em vez de ser forçado numa categoria por associação de palavras.

A honestidade também é uma decisão de produto: uma investigação empírica sobre a lacuna de €/kg mostrou que re-ler as notas recuperava **um único** item — o resto era ausência real na fonte, não perda de extração. Marcá-los corretamente é mais valioso do que inventá-los.

## 8. Deduplicação robusta de documentos

A mesma compra pode entrar duas vezes se o documento for re-submetido e a leitura variar. A deduplicação é **em camadas**, da mais barata e específica para a mais robusta: (i) **número do documento por cadeia** — o nº fiscal é único por cadeia, logo `cadeia = ∧ nº-documento =` é um duplicado imediato (rede mais forte quando o nº é lido); (ii) **nº-documento OU (data + total)** no âmbito da loja; e (iii) a rede robusta abaixo. Uma deduplicação só por (loja, data, total) falha precisamente quando o modelo **lê mal a loja ou a data** — observámos um VLM ler consistentemente uma cadeia como outro nome e errar o ano. Daí a chave robusta a leituras erradas:

$$\text{duplicado} \iff \text{cadeia} = \wedge\ \text{total} = \wedge\ |\text{itens}| = \wedge\ \text{sobreposição-de-preços} \ge 0{,}7\,|\text{itens}|$$

onde a *sobreposição* é o tamanho da interseção dos multiconjuntos de preços, com tolerância de ±0,02 € (cêntimos de OCR). É um sinal forte porque, com itens a peso, **dois trajetos de compra reais quase nunca produzem o total exatamente igual ao cêntimo** — o que distingue um duplicado de uma "compra do costume".

## 9. Avaliação empírica

> **Aviso de calibração.** As observações vêm de uma amostra **pequena e benigna**: utilizador único, fotografias cuidadas, 58 talões, ~600 itens de produto, 6 cadeias (predominância de três). Os números são indicativos, não generalizáveis a um cenário público (volume, fotos descuidadas, muitas cadeias). **Re-medir com dados reais antes de fechar decisões.**

- **Agrupamento pela chave determinística:** F1 = 1.0 sobre dados limpos, transversal a cinco modelos de fronteira — evidência de que a chave (não o modelo) é determinante.
- **Novo *vs* antigo (150 descrições reais):** 99,4% de concordância; as divergências eram, na sua maioria, **melhorias** do método novo (correção de canonicalização, separação de variantes, desfazer colapso de marca).
- **Ruído estrutural nas descrições:** ~13–29% das linhas tinham ruído (prefixos, peso/preço colados), na quase totalidade removível por limpeza determinística; um resíduo (~4%) é garble genuíno de leitura.
- **Extração foto (head-to-head):** VLM-direto reconcilia 9/10 talões contra 3/10 de OCR clássico→LLM; o OCR de foto leva o LLM a alucinar a partir do ruído.
- **Lacuna de €/kg:** dos itens a peso sem €/kg, a re-leitura recuperou ~1; o restante é ausência na fonte (cadeias de desconto) — hoje tratado por `peso_em_falta`.
- **Re-leitura integral (reset):** ao re-processar os 58 talões com o pipeline atual, a reconciliação fecha (discrepância 0,00) na quase totalidade das notas, contra um punhado de discrepâncias antes.

## 10. Limitações e tensões de desenho

1. **Marca como filtro duro vs. nome *brand-agnostic*** — fragmenta o mesmo produto com/sem marca; a auto-fusão por nome idêntico é uma muleta. Repensar se a marca deve ser filtro duro só para embalados, não para produto a granel.
2. **Quase-duplicados** ("Maçã Gala" vs "Maçã Royal Gala") — a fusão por nome idêntico não os apanha e a fusão por similaridade automática arrisca juntar produtos distintos; ficam para curadoria manual.
3. **Correspondência na consulta por substring** (`LIKE '%termo%'`) — mistura produtos ("leite" apanha "Doce de Leite"); evoluível para *embeddings* sobre o nome canónico.
4. **Não-determinismo do LLM na canonicalização** — amortecido pela cache e pela auto-fusão, não eliminado.
5. **Dependência da leitura a montante** — a normalização é tão boa quanto a extração; muitos €/kg estranhos são erros de formato/quantidade na leitura, não da normalização.
6. **Facetas-B ligadas POR PRODUTO, ainda não pela coorte** — a ingestão EAN→OFF já popula os atributos ocultos (açúcar, Nutri-Score, NOVA, aditivos) para o produto **scaneado** (§6.4), fora da chave como previsto. Falta a **herança pela classe** (um irmão scaneado dar nutrição aos restantes da coorte) e a estimativa por mediana/dispersão da categoria.

## 11. Trabalho futuro

- **Ligação EAN→OFF** — **já implementada** (2026-06-08) por três vias de EAN (scan, foto, linha do talão; §6.4), populando facetas-B (nutrição, Nutri-Score, NOVA, aditivos) sem re-particionar a identidade. Falta robustecer o caso **EAN válido-mas-errado** (cruzamento sistemático EAN↔descrição) e estender as facetas-B à **coorte** (herança entre irmãos da mesma classe).
- **Embeddings** para a correspondência em tempo de consulta (cross-loja) e para os quase-duplicados.
- **Resolução de categoria a um nó OFF fino** como passo determinístico (hoje parcial), generalizando a canonicalização de denominação para além do queijo.
- **Promoção de Mestres provisórios** quando uma re-leitura, um EAN ou o operador resolvem uma faceta-portão em falta.
- **Avaliação em escala** com anotação humana e métricas de *entity resolution* (precisão/cobertura de pares) sobre dados menos benignos.

## 12. Conclusão

A combinação que funciona não é "um LLM melhor", mas uma **arquitetura** onde cada componente faz o que faz bem: o modelo lê texto/imagem e propõe; o **código determinístico decide a identidade** (chave facetada), calcula o preço comparável e arbitra duplicados; e o sistema **admite o que não sabe** em vez de o fabricar. O modelo facetado (portões vs dimensões, naturezas A/B/C, chave estável) dá a estrutura; a cascata de correspondência com cache que aprende dá a escala; e a disciplina de incerteza honesta dá a confiança nos números. Casar uma descrição incompleta com o produto certo deixa de depender da completude da string e passa a depender da recuperabilidade das **facetas-portão** — um alvo muito mais robusto.

---

## Referências

- Open Food Facts — taxonomia de categorias: <https://wiki.openfoodfacts.org/Global_categories_taxonomy> · dados/API: <https://world.openfoodfacts.org/data>
- GS1 GPC (Global Product Classification): <https://www.gs1.org/standards/gpc/how-gpc-works> · browser: <https://gpc-browser.gs1.org/>
- IFPS PLU codes: <https://www.ifpsglobal.com/plu-codes>
- Regulamento (CE) 1924/2006 (alegações nutricionais): <https://eur-lex.europa.eu/eli/reg/2006/1924/oj?locale=pt>
- Dice, L. R. (1945). *Measures of the Amount of Ecologic Association Between Species.* Ecology 26(3).

*Este relatório descreve o procedimento do projeto Bigbag (laboratório pessoal). Os documentos `Taxonomia_Produto.md` e `Normalizacao.md` contêm, respetivamente, a especificação detalhada do modelo facetado e o estado de implementação com casos reais.*

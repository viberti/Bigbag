# Nutri-Score no BigBag — cálculo, dados em falta e nota personalizada

> **O que é este documento.** Explica (1) **como calculamos** a nota Nutri-Score hoje, (2) **como a falta de informação afeta** o cálculo e as guardas que pusemos, e (3) um **plano para uma fase nova**: uma nota **específica para o perfil do utilizador** — "este produto, para *si*, vale X". É um documento de **análise e plano**; a Parte III ainda **não está implementada**.
>
> Fontes-fonte relacionadas: [`Visao_Conselheiro_Saude_Alimentar.md`](Visao_Conselheiro_Saude_Alimentar.md) (perfil de saúde, avaliação personalizada em texto), [`Normalizacao.md`](Normalizacao.md) (nutrição canónica), `backend/src/normaliza/nutriscore.js` (código), `backend/src/normaliza/familia.js` (`classeNutriScore`), `backend/src/routes/produto.js` (`/info`).

---

## Parte I — Como calculamos o Nutri-Score hoje

### 1. Origem e âmbito
Implementamos o **algoritmo oficial Nutri-Score 2023** (em vigor desde 31/12/2023, o que França/Alemanha/Bélgica/Países Baixos/Suíça adotaram e o Open Food Facts usa), tal como publicado pelo **comité científico internacional** (*Merz et al., Nutri-Score 2023 update*, **Nature Food** 5, 102–110, 2024 — ver Fontes). É **determinístico** e corre a partir da **nutrição por 100 g/ml** que temos na ficha fundida do produto (`nutricao_100g`: `energia_kcal`, `gordura_saturada`, `gordura`, `acucares`, `sal`, `fibra`, `proteina`). As fórmulas exatas da escala de gorduras (saturada como rácio saturada/total, energia da saturada `SFA × 37 kJ/g`, exclusão da proteína quando os negativos são altos) reproduzem a **referência técnica FSA-NPS 2023** (ver Fontes) — não são aproximação nossa.

O código vive em **`backend/src/normaliza/nutriscore.js`**, função `nutriScore(n, opts)`. O `/info` chama-a uma vez por ficha:
```js
nutriscore_calc: nutriScore(nutricaoDisplay, { classe: classeNutriScore(familiaSlug) })
```

### 2. As quatro escalas (a classe vem da FAMÍLIA, não do grupo)
O mesmo conjunto de nutrientes pontua de forma diferente conforme o **tipo** de produto. Usamos 4 escalas, escolhidas por `classeNutriScore(familiaSlug)` em `familia.js`:

| Classe | Quando | Particularidade |
|---|---|---|
| **`solido`** (default) | alimentos sólidos gerais | tabelas-base 2023 |
| **`bebida`** | família ∈ {leite, sumo, refrigerante, cerveja, vinho} | energia/açúcar **muito mais severas**; **nunca dá A** |
| **`agua`** | família água | dá **sempre A** |
| **`gordura`** | família ∈ {azeite, óleo, manteiga} | energia a partir da **saturada** (não da total) + saturada como **rácio** saturada/total |

> **Porquê a família e não o grupo de loja:** o **leite** está em *laticínios* (grupo de loja) mas no Nutri-Score conta como **bebida**; o **azeite** é *mercearia* mas tem de usar a escala das gorduras. A "lente" certa para a saúde é a família, não o corredor.

### 3. Pontuação — negativos menos positivos
A nota bruta são **PONTOS**: somam-se os componentes "maus" (A) e subtraem-se os "bons".

**Componentes NEGATIVOS (A) — quanto maior, pior:**

| Nutriente | Sólidos | Bebidas | Gorduras/óleos |
|---|---|---|---|
| Energia | `L_ENERGIA` (kJ, 0–10) | `L_ENERGIA_BEB` (0–10, severa) | da **saturada**: `sat × 37 kJ/g` → `L_ENERGIA_SAT` |
| Açúcares | `L_ACUCAR` (0–15) | `L_ACUCAR_BEB` (0–10) | `L_ACUCAR` (geral) |
| Gordura saturada | `L_SATURADA` (0–10) | `L_SATURADA` | **rácio** `sat/total ×100` → `L_SAT_RATIO` (0–10) |
| Sal | `L_SAL` (0–20, sal direto) | `L_SAL` | `L_SAL` |

**Componentes POSITIVOS — quanto maior, melhor (subtraem):**

| Nutriente | Escala | Nota |
|---|---|---|
| Fibra | `L_FIBRA` (0–5) | — |
| Proteína | `L_PROTEINA` (sólidos/gorduras 0–7) · `L_PROTEINA_BEB` (bebidas) | ver cap abaixo |
| % fruta/legumes/frutos secos | **assumida 0** | ver Limitação 1 |

**O *cap* da proteína:** quando os negativos são altos (`A ≥ 11` nos sólidos/bebidas, `≥ 7` nas gorduras) **e** a %fruta < 5, a **proteína não conta**. Evita que um produto mau "compense" a má nota só por ser rico em proteína (ex.: carnes processadas).

```
pontos = (A ≥ cap && fruta < 5)  ?  A − (fibra + fruta)
                                  :  A − (fibra + proteína + fruta)
```

### 4. Da letra A–E aos PONTOS à NOTA 0–100
O oficial só produz **letra A–E** e os **pontos** (escala com sinal, ~−15 a +40, **menor = mais saudável**). Como "+5" confunde o utilizador, mapeamos os pontos para uma **nota 0–100, MAIOR = mais saudável**, **ancorada nas fronteiras das letras** (cada letra = uma fatia de 20 pontos), interpolando linearmente dentro da banda:

| Letra | Banda 0–100 | Exemplo |
|---|---|---|
| A | 80–100 | leguminosa → ~89 |
| B | 60–80 | leite meio-gordo → 75 |
| C | 40–60 | azeite → ~53 |
| D | 20–40 | — |
| E | 0–20 | refrigerante → ~10 |

A função `notaCem(pontos, classe)` usa breakpoints por classe (`BREAKS_SOLIDO`, `BREAKS_GORDURA`, `BREAKS_BEBIDA`) — assim a nota fica **sempre coerente com a letra e com a cor do semáforo**, e funciona para todas as classes. A água dá sempre 100; as bebidas nunca chegam a 100 (só a água é A). Inspirado nas bandas do Yuka.

`nutriScore()` devolve **`{ pontos, grau, nota100 }`**. A UI v2 mostra a **`nota100`** (os pontos crus ficam no tooltip).

### 5. Cortes de letra (resumo)
| Classe | A | B | C | D | E |
|---|---|---|---|---|---|
| Sólidos | ≤ 0 | ≤ 2 | ≤ 10 | ≤ 18 | > 18 |
| Bebidas | — | ≤ 2 | ≤ 6 | ≤ 9 | > 9 |
| Gorduras | ≤ −6 | ≤ 2 | ≤ 10 | ≤ 18 | > 18 |

---

## Parte II — Como a falta de informação afeta o cálculo

### 1. O princípio (regra dura do dono)
> **Dados em falta NUNCA podem MELHORAR a nota.** Assumir 0 num componente *negativo* ausente tornaria o produto artificialmente mais saudável. Isso era um bug real (ver o caso do azeite, §4).

Esta postura defensiva é a recomendada para o **Open Food Facts**, fonte crowdsourced de completude desigual (análises apontam **só ~⅔ das entradas com macronutrientes completos**, ⚠️*nº exato a confirmar*; o próprio OFF avisa que não garante exatidão e que o utilizador assume o risco). Codificar a verificar a presença do campo antes de confiar nele — e a guarda de plausibilidade (§3) — são essa camada de validação (ver Fontes).

A leitura disto separa os campos em dois tipos:
- **Negativos** (energia, saturada, açúcar, sal): em falta → **não se assume 0**; ou se exige, ou se devolve `null` (sem nota), conforme a classe.
- **Positivos** (fibra, proteína, %fruta): em falta → **assume-se 0** (conservador: nega-se o bónus, nunca se inventa). Isto é seguro.

### 2. Campos obrigatórios vs assumíveis — por classe
| Campo | Sólidos/Bebidas | Gorduras/óleos |
|---|---|---|
| `energia_kcal` | **obrigatório** | **obrigatório** |
| `gordura_saturada` | **obrigatório** | **obrigatório** (decide a nota) |
| `gordura` (total) | não usado | **obrigatório** (precisa do rácio saturada/total) |
| `acucares` | **obrigatório** | **assume 0** (óleo puro ≈ 0 — é a verdade, não palpite) |
| `sal` | **obrigatório** | **assume 0** (idem) |
| `fibra`, `proteina` | assume 0 (positivos) | assume 0 |

Em falta um obrigatório → **`nutriScore` devolve `null`** (a ficha não mostra nota, honestamente) em vez de inventar.

### 3. Guarda de plausibilidade — dados impossíveis → `null`
Além de "em falta", há dados **errados** (lixo do Open Food Facts crowdsourced). Rejeitamos os fisicamente impossíveis, de forma **geral** (não por produto) — `problemasNutricao`/`nutricaoPlausivel` em `validadores.js`, o gate que o fusor (`fichaEan.js`) já aplica a cada fonte:
- Qualquer macro **negativo** ou >100 g/100 g; `kcal` fora de [0, 950]; açúcares > hidratos; **saturada > gordura total** (`sat=72` num óleo com `gordura=13`); soma de macros > 105 g.
- **Reconciliação de ENERGIA (Atwater, 2026-06-30):** a energia declarada não pode ser **muito menor** que a que as macros implicam (`4·prot + 4·hidratos + 9·gordura + 2·fibra` kcal/g) — apanha o azeite `kcal=8,84`. **Assimétrico:** a direção inversa (declarada > prevista) **não** penaliza (álcool 7 kcal/g e polióis não entram nas macros e explicam-na — vinho, rebuçados sem açúcar).
- **Medição do corpus (2026-06-30):** na `base_local` (54 391 c/ nutrição), **3,3 %** eram impossíveis (1 052 macro negativa, 580 Atwater, 129 kcal fora, 77 soma>105, 58 saturada>gordura, 55 açúcar>hidratos) → **limpos** (`nutricao→NULL`; "sem nota > nota errada"). A `base_local` é materializada por SQL fora do fusor, por isso o gate corre também no `build_base_local` + backfill (`scripts/limpar_nutricao_base_local.mjs`).

**Envelope de plausibilidade POR FAMÍLIA (a acrescentar).** A guarda genérica não apanha um azeite com `saturada = 72 %` (palm/coco existem, logo `72 < total` é "possível" no geral). Mas como **já ramificamos por família** para escolher a escala, podemos ter **envelopes por família** — ex.: azeite com saturada **fora de ~[10, 25] %** é dado suspeito → `null`. Isto **não viola** a regra "geral, não por produto" (a família é tão geral quanto a classe), apanha o `sat=72` que sobra hoje, e limita o estrago da má classificação ("croutons com azeite") sem a resolver. Custo: multiplica config; fica como melhoria da Parte II.

### 4. Caso real — o azeite (antes/depois)
Os azeites davam notas dispersas (`50 / 65 / 80 / null`). Diagnóstico sobre 181 azeites da `base_local`:

| | Antes | Depois |
|---|---|---|
| C (~53, correto) | 135 | **155** |
| `null` | 40 | 14 |
| Notas altas/baixas espúrias | várias | só lixo de dados |

Mudámos: (a) para gorduras, exigir **saturada + gordura total** e **assumir açúcar/sal = 0** → recuperou 28 azeites que davam `null` só por terem açúcar/sal a `NULL`; (b) **deixou de cair para a escala de sólidos** quando falta a total (dava um E injusto) → `null`; (c) **guarda de plausibilidade**. Resultado: azeite real = **C consistente**; lixo de dados = `null`, nunca uma nota inflada.

> Sobram dois problemas **separados do cálculo**: (1) **má nutrição na fonte** que é "possível mas errada"; (2) **classificação**: "Croutons/Petinga **com/em azeite**" entram como família azeite e ganham nota inflada → ver tarefa de classificação separada em `familiaPorNome`.

#### 3b. Camada C — corroboração do "plausível-mas-errado" (2026-06-30)
O Atwater/plausibilidade (camada A) apanha o **impossível**; um valor pode ser possível mas errado (azeite `saturada=72 %` com kcal coerente passa em tudo). Duas vias de **corroboração** (sinal de **suspeita** → confiança/revisão, **não** se apaga):
- **C2 — envelope por família** (`envelopeNutricao.js`, 6 testes): aprende a distribuição robusta (percentis) de cada nutriente por família, do corpus limpo. **Gate de homogeneidade** — só sinaliza onde a família é apertada (senão, formas misturadas: leite líquido/pó, batata fresca/frita → 30 % de falsos; com o gate, **2,1 %** preciso). Cobre todos os produtos, mas só nas ~30 famílias homogéneas.
- **C1 — concordância entre fontes** (medido): dos 29 874 EANs com `kcal` em catálogo **e** OFF, **8,8 % discordam >20 %** → pelo menos uma fonte errada. É a corroboração mais fiável (compara o MESMO produto), mas só onde há ≥2 fontes.
- **C3 — consenso de NOME** (`limpar_nutricao_consenso.mjs`, 2026-06-30): produtos do MESMO nome num grupo MUITO apertado (≥80 % dentro de ±15 % da mediana de kcal = commodity sem variantes) → um outlier **ALTO** (kcal > mediana×1,8) é erro → anula (re-resolve). Apanha o que A e C2 não apanham — ex.: "leite meio-gordo" 8×~48 kcal (B) + 1×560 kcal (E, leite em pó/lixo); o outlier escapa ao Atwater (energia ALTA vs macros) e ao envelope (leite é família heterogénea). SÓ alto de propósito (kcal baixo pode ser variante light/zero legítima). Limpou **12** (0,02 %), todos erros claros. *Materializado:* `base_local.ns_*` (migr. 095) permite a auditoria por SELECT ("mesmo nome, notas diferentes"); o que sobra (~131 grupos) é diversidade legítima de nomes genéricos ou erros do lado baixo → **revisão humana**, não auto-limpeza.
- **Camada F (FEITO p/ a nota universal, 2026-06-30):** `confiancaNutricao.js` funde completude + corroboração (`nutricao_confirmada`) + suspeita de família (C2) num **nível** (alto/médio/baixo); o `/info` devolve `nutriscore_confianca` e a ficha v2 mostra um selo **"dados a confirmar"** ao lado da nota quando não é `alto` (a nota universal NÃO se esconde — é factual; ganha ressalva). Para a nota **pessoal**, a confiança liga-se ao §5 (mostrar com ressalva / só avisos).
- **Camada LLM — análise antes da revisão humana (FEITO, 2026-06-30):** os sinais determinísticos dizem "isto é suspeito" mas não sabem o valor certo. Um **LLM (gemini-flash) audita** cada suspeito (envelope C2 + `sal=0` em família salgada) — com conhecimento da composição típica do alimento — e dá veredicto **ok | erro | incerto** + o campo errado + valor típico + razão (`auditarNutricaoLLM.js`, `nutricao_auditoria` migr. 096). Ex.: "Gouda Velho sal=0 → **erro**, queijo curado tem ~1,8 g"; mas "Jaca em Calda sal=0 → **ok**, pouco sal natural". Triagem: 'ok' sai da fila; 'erro'/'incerto' vão ao humano **já com a análise**. NÃO altera dados — só analisa. (1.º lote: 23 erro / 7 ok em 30, precisão alta.)
- **Falta (C1 live + E + UI de revisão):** discordância entre fontes não persistida no fusor (confiança usa `nutricao_confirmada` como proxy); auditoria por foto/VLM (camada E); e a **aba de revisão humana** que consome `nutricao_auditoria` (erro/incerto).

### 5. Limitações assumidas de propósito
1. **Sem % de fruta/legumes/frutos secos** (não parseamos ingredientes) → assume 0. **⚠️ Não é um viés neutro** (correção 2026-06-30): o bónus de fruta é *diferencial* — distingue um produto com 60 % de fruta de um com 0 %. Assumir 0 para todos **penaliza sistematicamente o alimento real** face ao processado (uma compota e um rebuçado com açúcar parecido ficam ao mesmo nível, quando o oficial daria o bónus à compota). As comparações só são "justas" entre produtos com teor de fruta **parecido** — exatamente quando não importa. Tolerável numa *label* factual; **mais grave numa feature que ordena e recomenda** (ver Parte III §9 — viés do recomendador).
2. **Sem deteção de adoçantes não-nutritivos** → não aplicamos a penalização de +4 das bebidas (2023). Aponta na mesma direção que (1): favorece o reformulado face ao simples.
3. **Sem escala dedicada de queijos** (a proteína conta sempre) — a acrescentar se valer.

### 6. Tabela-resumo: comportamento por campo em falta
| Situação | Resultado |
|---|---|
| Falta energia **ou** saturada | `null` (todas as classes) |
| Sólido/bebida sem açúcar **ou** sem sal | `null` |
| Óleo sem açúcar/sal | assume 0 → calcula |
| Óleo sem gordura total | `null` |
| Falta fibra/proteína | assume 0 (sem bónus) → calcula |
| Macro negativo ou saturada>total | `null` (dado impossível) |

---

## Parte III — Fase nova: Nutri-Score **personalizado** (nota para o perfil)

### 1. Motivação
A mesma comida **não é igualmente saudável para toda a gente**. Um queijo curado salgado é pior para quem tem **hipertensão**; um sumo é pior para quem tem **diabetes**; um produto calórico-denso pesa mais para quem tem **objetivo de perda de peso**; um produto com **glúten/lactose** pode ser proibitivo por dieta/alergia. O Nutri-Score universal não vê nada disto.

**Objetivo:** além da nota universal (factual), produzir uma **"nota para si"** — a mesma escala 0–100, mas **modulada pelo perfil de saúde do utilizador**, com os **motivos** explícitos.

### 2. O que já temos (matéria-prima)
- **Perfil de saúde estruturado** (editor v2 `PerfilSaude`, `perfil_membro.saude_estado`, migr. 066) com **9 grupos de pílulas**: **Objetivos · Condições · Dieta · Preferir · Evitar · Metas · Suplementos · Medicação · Atividade física**, + demografia (idade/sexo/peso/altura) e notas livres. As "ativas" são os arrays do `resumo` que a avaliação lê.
- **`perfilParaTexto`** — serializa o perfil como bloco etiquetado que já vai ao prompt da **avaliação personalizada em texto** (o "parecer" da ficha). **Mas isto é texto gerado por LLM, não uma NOTA** — não é comparável, ordenável nem auditável.
- **Nutrição canónica por 100 g** já normalizada (a mesma que alimenta o Nutri-Score universal).

> A peça que **falta** é uma **NOTA numérica determinística por (produto × perfil)**, que se possa **ordenar** (ex.: ordenar alternativas "para si"), **comparar** na prateleira e **auditar** (porquê esta nota).

### 3. Princípio de desenho: **duas camadas, nunca destruir a universal**
Alinhado com a separação que já usamos no projeto (IDENTIDADE universal vs PREÇO/LOCALE por país), aqui:

```
  NOTA UNIVERSAL (factual, partilhada)         →  o Nutri-Score 0–100 de hoje
        │
        ▼  (camada de personalização, por utilizador)
  NOTA PARA SI (0–100)  +  Δ vs universal  +  motivos  +  alertas
```

- A nota universal **mantém-se sempre visível** (referência objetiva; transparência).
- A personalização é uma **transformação por cima**, não uma substituição.
- **Determinística e auditável** (motor de regras), **não** uma 2.ª chamada ao LLM. O LLM continua só no **parecer textual** (que explica em linguagem humana o que o motor decidiu).

### 4. Como personalizar — motor de regras GRADUADAS (proposta)

> **Decisão de desenho (dono, 2026-06-30):** *não* usar multiplicadores de peso por nutriente, mas **regras com limiar e impacto graduado**. Razão: um multiplicador (ex.: `sal ×2`) penaliza **em todo o lado, incluindo a zona segura** — pune um produto *baixo em sal* só porque o utilizador é hipertenso, o que não é como um humano raciocina. Uma regra com limiar só penaliza **quando o nutriente passa a ser um problema real**. É mais expressivo, mais próximo do raciocínio clínico, e dá **motivos cristalinos**.

#### 4.1 Em que UNIDADE corre a personalização (resolvido — ponto que faltava)
> Esta era uma **ambiguidade real** das versões anteriores deste doc (e que duas revisões externas não apanharam): os impactos estavam escritos como se fossem "−18" mas não dizia se em **pontos** (a escala interna −15..+40) ou em **nota 0–100**. **Decisão (dono, 2026-06-30): a personalização corre em PONTOS**, como uma camada que se **soma aos pontos-base depois** do cálculo universal, e só então se mapeia para 0–100.

Pipeline:
```
pontos_base = nutriScore(nutrição, classe).pontos          // universal, intacto (cap da proteína já aplicado)
   // se pontos_base == null (dados insuficientes) ⇒ NÃO há nota pessoal (pessoal = null). A pessoal
   // exige sempre um base válido; a "confiança" (§5) só varia entre produtos que já têm base.
pontos_pessoal = pontos_base + Σ(penalidades) − Σ(bónus)   // camada pessoal, em PONTOS
nota100_pessoal = notaCem( clamp(pontos_pessoal), classe )  // MESMO mapeamento de bandas → letra coerente
```
Porquê em pontos e não na nota 0–100:
- **Mantém a coerência letra↔nota** (a nota pessoal ainda cai numa banda A–E; o exemplo "é um B, mas para si é um D" funciona naturalmente). Subtrair na nota100 quebraria isto.
- **Compõe com o base na mesma moeda** — o base já acumula pontos por nutriente; a camada pessoal acrescenta mais pontos ao mesmo acumulador.
- Torna **explícito o "somar vs substituir"** (§4.6): a camada pessoal **acrescenta** penalização à do base, não a substitui.
- Consequência prática: os **tetos das regras são em PONTOS** (números pequenos, ~3–8), não dezenas. Aplica-se `clamp` para a nota não sair de 0–100.

> **Calibrar e ordenar SEMPRE em pontos; a nota100 é só pele de exibição.** A `notaCem` é linear-por-troços com **declives diferentes** (as bandas têm larguras diferentes em pontos: nos sólidos B ocupa 2 pontos, C ocupa 8). Logo o mesmo `teto_pts` produz **deltas de nota100 diferentes** consoante a banda → calibrar olhando para a nota100 persegue um alvo móvel. A `notaCem` é monótona, logo *ordenar por nota100 = ordenar por pontos* **dentro da mesma classe** — mas como usa breakpoints por classe, **nunca ordenar uma lista que mistura classes pela nota100** (60 num sólido ≠ 60 numa bebida). A ordenação de alternativas tem de ser **por pontos e dentro da mesma classe/coorte**.

> **Cap da proteína vs bónus pessoal de proteína (regra dura).** O `pontos_base` já tem o cap aplicado (proteína não conta se A ≥ 11 — para impedir que o processado se safe por ser proteico). Um bónus pessoal "+proteína" somado *depois* **re-creditaria** essa proteína e reverteria exatamente o que o cap protege (caso real: atleta a olhar para carne processada). Regra: **se o base estava no regime capado, suprimir também o bónus pessoal de proteína.**

> **Zona morta do clamp (efeito de fronteira, inerente).** Num produto já no fundo (E, saturado de sal), somar +8 pessoal não muda a nota 0 → "para si é ainda pior" **não se exprime entre produtos péssimos**. A personalização só "morde" no meio da gama. Aceitável para ranquear alternativas medíocres, mas é bom saber que é inerente ao clamp.

#### 4.2 Por que graduada e não "degrau"
A forma intuitiva de uma regra é um **degrau**: `SE sal > 1,2 g → +8 pts, senão 0`. Mas o degrau tem o problema do **precipício**:
> sal = **1,19** → 0 · sal = **1,21** → +8.
Dois produtos quase idênticos ficam com notas radicalmente diferentes e a ordenação fica instável à beira do limiar. A solução é uma regra **graduada**: abaixo de um **limiar seguro** = 0 (resolve o defeito do multiplicador); acima, o impacto **cresce progressivamente** até um **teto** (resolve o degrau).

Comparação dos três modelos, com o **sal para um hipertenso** (impacto em **pontos de penalização**; somam-se ao A, maior = pior, a nota 0–100 desce):

| sal (g) | Peso ×2 (pts extra) | Degrau (>1,2 → +8) | **Graduada** (seguro 0,3 · teto +8 a 1,5) |
|---|---|---|---|
| 0,2 | +1 ❌ pune o seguro | 0 ✓ | **0** ✓ |
| 0,8 | +4 | 0 ❌ ignora sal a sério | **+3,3** ✓ |
| 1,19 | ~+6 | 0 | **+5,9** ✓ |
| 1,21 | ~+6 | +8 ❌ salto | **+6,1** ✓ (sem salto) |
| 2,5 | +12 | +8 | **+8** (teto) ✓ |

#### 4.3 A forma da regra
```
Regra = { condição, nutriente, limiar_seguro, limiar_alto, teto_pts, direção }
impacto_pts = direção × teto_pts × clamp( (valor − limiar_seguro) / (limiar_alto − limiar_seguro), 0, 1 )
```
- **direção** `+1` penaliza (soma pontos ao A: sal, açúcar, saturada, energia) · `−1` bonifica (subtrai pontos: fibra, proteína).
- **`teto_pts` em PONTOS** (a moeda do base), não em nota100 (ver §4.1).
- **Limiares ENERGIA-RELATIVOS, ancorados na OMS/PAHO** (correção 2026-06-30 — ver §4.4): o `valor` da regra **não** é g/100 g absoluto (como o `SF_LIMIARES`), mas a **fração de energia** do produto (saturada e açúcar como % da energia; sódio como mg por kcal). É a base do **modelo de perfil de nutrientes da PAHO**, "ajustado às necessidades energéticas, não um valor fixo/dia" — o que permite **deslocar o limiar por condição** (a substância da feature).
- **O multiplicador é um caso particular** desta forma (rampa que começa em 0 e nunca satura) → não perdemos expressividade, ganhamos.

> **⚠️ O limiar POR CONDIÇÃO é a substância da feature, não afinação.** Reusar a banda geral para um hipertenso faz a penalização disparar **no mesmo nível** em que o universal já penaliza → só acrescenta **magnitude** ("conta mais"), não **desloca o limiar**. O conteúdo clínico de "pior para si" é que o limiar do hipertenso é **mais apertado** — penalizar sal *moderado* que a população geral ignora ("mais cedo", não só "mais forte"). A solução com **respaldo citável** (não o `SF_LIMIARES` front-of-pack, que é genérico) é ancorar nas **metas de ingestão OMS** e **apertá-las por condição** com a diretriz clínica respetiva (§4.4). *Nuance:* amplificar magnitude não é nulo (muda o gradiente), mas é a metade fraca; o "mais cedo" é o coração.

#### 4.4 Limiares ancorados na OMS/PAHO (energia-relativos) + aperto por condição
**(a) Âncoras GERAIS** (população geral — o `alto` = cutoff de "excesso" da PAHO; o `seguro` = meta ideal OMS):

| Nutriente | Base (energia-relativa) | seguro | alto | Fonte (verificada 2026-06-30) |
|---|---|---|---|---|
| Açúcares (livres) | `açúcar_g×17kJ / energia_kJ` | **5 %E** | **10 %E** | OMS livres <10 % (ideal <5 %) · PAHO excesso ≥10 %E |
| Gordura saturada | `sat_g×37kJ / energia_kJ` | **5 %E** | **10 %E** | OMS saturada <10 %E · PAHO excesso ≥10 %E |
| Sódio | `Na_mg / kcal` (sal_g×400 / kcal) | **0,5** | **1,0** | PAHO excesso ≥ 1 mg/kcal (rácio 1:1) |
| Gordura total | `gordura_g×37kJ / energia_kJ` | 15 %E | **30 %E** | PAHO excesso ≥30 %E |

**(b) APERTO por condição** (desloca `seguro`/`alto` para baixo pelo fator da diretriz clínica):

| Condição / objetivo (faceta) | Nutriente | seguro → alto (apertado) | fator vs geral | Fonte do aperto | teto (pts) | dir |
|---|---|---|---|---|---|---|
| Hipertensão | sódio | **0,375 → 0,75** mg/kcal | ×0,75 | DASH baixo-sódio **1500** vs 2000 mg/dia | 8 | + |
| Diabetes / pré-diabetes | açúcares | **2,5 → 5 %E** | ×0,5 | OMS condicional **<5 %E** (vs <10 %) | 8 | + |
| Dislipidemia / colesterol alto | saturada | **3 → 6 %E** | ×0,6 | AHA **<5–6 %E** p/ baixar LDL | 6 | + |
| Objetivo perda de peso | densidade energética | **150 → 400** kcal/100 g | — | Rolls 2003 (médio→alto) | 5 | + |
| "Mais fibra" / intestinal | fibra | **3 → 6** g/100 g | — | UE 1924/2006 "fonte"→"alto teor" | 4 | − |
| Objetivo massa muscular | proteína | **12 → 20 %E** | — | UE 1924/2006 "fonte"→"alto teor" (c/ cap §4.1) | 5 | − |
| **Doença renal crónica** | — | **SÓ aviso textual, SEM nota** | — | ver ⚠️ DRC | — | — |

> **Notas:** (1) **todas as regras têm agora âncora citável** — penalização nas metas OMS/PAHO, bónus/objetivo nas claims UE 1924/2006 (fibra/proteína) e na densidade energética de Rolls (perda de peso). (2) Os **fatores de aperto** vêm de cada diretriz (DASH, OMS, AHA), não de palpite — é o que tira da "calibração subjetiva do dono" para "calibração ancorada e citável". (3) Só os `teto_pts` (a **magnitude**) continuam a calibrar (§10.9); os **limiares** já não são inventados.

> ⚠️ **Doença renal crónica (DRC) — não dar nota numérica.** A necessidade de proteína **inverte-se** com o estágio (pré-diálise *restringe*, diálise *incrementa*); o perfil v2 só capta "Condições" genéricas → adivinhação perigosa. **E há conflito ENTRE condições:** o **DASH** (padrão-ouro da hipertensão, que a nossa regra de sódio empurraria) é **contraindicado em DRC** pelo teor de potássio/fósforo/proteína — a mesma comida que a regra de hipertensão recomendaria é contraindicada se a pessoa também tiver DRC. Uma nota "para si" única apontaria na direção clinicamente errada. Postura: **suprimir a nota pessoal e só avisos textuais** — a decisão mais defensável do documento.

#### 4.5 Flags DUROS (dieta/alergia) — sobrepõem as regras graduadas
Antes das regras graduadas corre uma camada **binária** para o que não admite gradação — ambos **bloqueio TOTAL** (não "penalização forte"):
- **Alergénio** do perfil (`Evitar`) presente na ficha → **bloqueia** a nota (cinzento + selo "Evitar: contém leite") e **fora da ordenação de alternativas**.
- **Incompatibilidade de dieta** (carne p/ vegetariano, glúten p/ celíaco) → **também bloqueio total**. Um vegetariano estrito não quer um chouriço *ordenado* nas alternativas, mesmo penalizado (decisão §10.2, fechada a favor de bloquear). 

Reusa os alergénios/ingredientes que a ficha já tem.

#### 4.6 Composição de várias condições — teto POR GRUPO, não global
Perfil com hipertensão **+** diabetes → **somam-se os `impacto_pts`** das regras ativas. **Mas o teto NÃO é um teto global único:** um teto global camuflaria múltiplas infrações graves (péssimo em sal *E* péssimo em açúcar satura o teto e parece menos mau do que é — a "cegueira cruzada"). 

Regra: **cap por grupo de nutrientes concorrentes** (sódio; açúcares; gorduras), de modo que **infrações em nutrientes diferentes acumulam** e só se limita a soma *dentro* do mesmo grupo (evita dupla penalização do mesmo eixo). O `clamp` final (§4.1) garante só que a nota não sai de 0–100. Bónus (fibra/proteína) entram na mesma soma de pontos.

> **A ENERGIA não é um grupo próprio (correção 2026-06-30).** A energia é **derivada das macros** — penalizar um produto gordo-e-doce no grupo-gordura, no grupo-açúcar **e** num grupo-energia conta a mesma riqueza calórica até três vezes, recriando a dupla contagem que o cap-por-grupo queria evitar. O particionamento tem de ser **ortogonal**: a energia é um **check derivado** (entra só onde uma regra de objetivo a usa diretamente, ex.: perda de peso), não um eixo concorrente independente.

> **Somar vs substituir (resolvido):** a camada pessoal **acrescenta** pontos aos do base — não substitui o tratamento que o base já dá ao nutriente. É intencional: o sal já conta no universal; para o hipertenso conta **mais**. O cap-por-grupo evita que esse "contar mais" exploda de forma incontrolada.

### 5. Dados em falta na camada pessoal + NÍVEL DE CONFIANÇA
O mesmo rigor da Parte II, agora **sensível à condição**, e com um **sinal de confiança** explícito (princípio geral do projeto: *saída derivada de dados que podem faltar expõe a sua completude*):
- Se falta **justamente o nutriente crítico para o perfil** (ex.: hipertenso, mas o produto não tem `sal` na ficha) → **não dar nota cega**; mostrar **aviso** ("não sabemos o sal deste produto — relevante para si").
- **Nível de confiança da nota pessoal** = quantos dos nutrientes que *importam para este perfil* estão presentes (ex.: "baseada em 3 de 4 fatores que te importam"). Exposto na UI, não escondido. **Política de exibição a definir** (decisão §10): a partir de que completude se mostra a nota vs só os avisos (ex.: ≥75 % mostra; <50 % só avisos)? — fica como número a calibrar, não inventado.
- Dados em falta nunca melhoram a nota para si — igual à universal. E a pessoal **exige um base válido** (`pontos_base` null ⇒ pessoal null, §4.1).
- A **demografia** (idade/sexo/peso) **está por especificar** — *como* é que idade/sexo/peso ajustam referências não está definido; é um placeholder que pode contrabandear complexidade. Diferido de propósito, mas **marcado como indefinido** (não implementar "às escondidas").

> **⚠️ Gate de SUFICIÊNCIA DE DADOS antes de construir o motor (novo, 2026-06-30).** A nota pessoal só corre onde há o nutriente crítico do perfil. A nossa realidade de dados é esburacada: hoje, dos 181 azeites, **14 ficaram sem nota** por nutrição incompleta, e o OFF tem buracos largos. Antes de P1, **medir em que fração dos scans reais a nota pessoal sequer teria dados** — se for baixa, a feature é esparsa e a discussão de tetos/limiares é prematura. É uma pergunta de viabilidade de 1.ª ordem, antes da engenharia.

### 6. Saída proposta (contrato)
```js
nutriScorePessoal(nutricao, classe, perfil) → {
  universal: { pontos, grau, nota100 },                    // o de hoje, intacto
  pessoal:   { pontos, grau, nota100, delta_pts },          // pontos_pessoal (§4.1) → grau+nota100
     // delta_pts = pontos_pessoal − pontos_base, em PONTOS (a verdade; a nota100 distorce por banda, §4.1).
  // uma entrada POR REGRA que disparou (graduada) — base dos "motivos" e da auditoria. efeito em PONTOS.
  motivos:   [ { regra:'hipertensão→sal', nutriente:'sal', valor:1.5, limiar:1.2, efeito_pts:+6.1 }, … ],
  alertas:   [ { tipo:'dado_em_falta', nutriente:'sal' }, … ],
  confianca: { fatores_presentes:3, fatores_relevantes:4 },   // §5 — completude da nota pessoal
  bloqueio:  null | { tipo:'alergenio'|'dieta', detalhe:'contém leite' }  // §4.5, bloqueio TOTAL
}
```
Cada `motivo` traz o **valor real**, o **limiar** e o **efeito em pontos** → o parecer diz "1,5 g de sal, acima do teu limite de 1,2 g → +6 pts de penalização (B → D)". A ficha v2 mostra a **nota para si** em destaque (com a universal ao lado e o **Δ**), os **motivos**, os **alertas** e o **nível de confiança**. **Ordenação só por pontos e dentro da mesma classe** (§4.1) — nunca uma lista numérica que mistura classes; *toggle* para ordenar pela universal (§10.6).

### 7. Determinístico vs LLM
- A **NOTA** e os **motivos** = **motor de regras determinístico** (auditável, testável, instantâneo, grátis). Esta é a peça nova.
- O **parecer em texto** (já existe) = LLM, que passa a **fundamentar-se na saída do motor** (não inventa o juízo; verbaliza-o). Evita o LLM dar uma "nota" inconsistente.

### 8. Faseamento de implementação (proposta, NÃO executar ainda)
- **P0 — Tabela de regras curada.** O mapa de §4.4 como dados (`config`, versionada com data+dono): por condição/objetivo, `{nutriente, base_energia, limiar_seguro, limiar_alto, teto_pts, direção, grupo, fonte}`, **ancorado nas metas OMS/PAHO energia-relativas** (não no `SF_LIMIARES`), com a **fonte de cada número**. Inclui os flags duros (alergia/dieta) de §4.5 e a exclusão da DRC.
- **P1 — Motor `nutriScorePessoal`** (puro, testável): regras graduadas em pontos (§4.1) + flags duros + composição com cap-por-grupo (§4.6) + dados-em-falta/confiança (§5). Golden de **perfis sintéticos** (`hipertenso_moderado`, `diabetico_tipo2_obeso`, `atleta_vegetariano`, `renal`…) × produtos conhecidos, ouro auditado; testar explicitamente a **ausência de precipício** (1,19 vs 1,21) e o **bloqueio** (dieta/alergénio).
- **P0.5 — Gate de SUFICIÊNCIA DE DADOS (antes de P1).** Medir em que **fração dos scans/fichas reais** a nota pessoal teria os nutrientes críticos presentes (§5). Se for baixa, a feature nasce esparsa → repensar âmbito antes de investir no motor.
- **P1.5 — Teste de ESTABILIDADE de ordenação** (antes da UI): correr o motor contra um catálogo de **~1000 produtos** por perfil e procurar **anomalias de ranking**. Classe de teste **obrigatória: "alimento integral vs reformulado"** — um produto com **adoçantes/substitutos de sal** a saltar à frente de um **alimento simples/integral** (o viés direcional das §§ Limitação 1/2 + gaming, §9). Se aparecer, o score precisa de guarda.
- **P2 — Ligar ao `/info`** (devolve `pessoal` quando há perfil ativo) e à **UI v2** (nota para si + Δ + motivos + confiança + ordenação com *toggle*).
- **P3 — Calibração** dos `teto_pts`/limiares contra o golden validado pelo **dono** (que É a referência — não há oráculo objetivo, ver §9).

### 9. Riscos e não-objetivos
- **Não é aconselhamento médico.** Manter o disclaimer; linguagem de *informação*, não prescrição. Especialmente sensível em **DRC/gravidez/medicação** — aqui preferir **avisar** a dar nota (DRC = sem nota numérica, §4.4).
- **Viés direcional do score baseado em nutrientes (Limitação 1 + 2 + gaming = o MESMO viés).** Assumir 0 % de fruta, ignorar adoçantes, e o gaming por substitutos apontam todos na mesma direção: **o alimento simples/integral fica desfavorecido face ao reformulado** (refrigerante *zero* à frente de um vegetal; rebuçado ao nível da compota). Numa *label* tolera-se; numa feature que **ordena e recomenda alternativas**, o sistema **sugere ativamente o substituto**, e o número 0–100 dá-lhe falsa confiança. Vigiar no P1.5 ("integral vs reformulado"); a prazo, penalização/etiqueta para ultraprocessados com substitutos (não nesta fase).
- **Não há ORÁCULO para a nota pessoal.** A universal tem algoritmo oficial como referência; a **pessoal não tem padrão-ouro**. O laço de calibração (P3) afina os tetos contra o **juízo do dono** → o sistema converge para **reproduzir as intuições do dono**. Para uma ferramenta de 2 utilizadores, está bem — mas há que assumir: o motor "genérico" é, na prática, uma forma elaborada de **codificar e tornar consistentes as preferências de 2 pessoas**, vestida de score de saúde.
- **⚠️ A autoridade falsa do NÚMERO — talvez não deva haver número pessoal.** Um "73 para si" carrega mais autoridade implícita que um parecer em texto, **precisamente porque parece o irmão do score universal e herda a credibilidade dele** — credibilidade que o caso pessoal não sustenta (sem oráculo, calibrado ao gosto do dono). Os `motivos` e o Δ ajudam, mas o número convida a uma confiança que a evidência não suporta. **Questão de desenho a sério (decisão §10):** a saída pessoal podia ser **flags + reordenação + parecer, SEM escalar numérico pessoal** — mantendo o número só no universal. Mata a falsa autoridade na raiz. Pesar contra a utilidade de um número ordenável.
- **Transparência:** a nota universal nunca desaparece; a personalizada mostra sempre **motivos** + **confiança**.
- **Conservador com dados em falta** (Parte II + §5) — não dar falsa segurança.
- **Não** sobre-ajustar com sinais fracos; as **regras devem ser poucas, claras e por condição** (regra GERAL, não por produto).
- **Multi-membro:** a nota é por **membro ativo** do perfil.
- **Reality-check (2 utilizadores).** O app é single-user com **2 perfis reais conhecidos** (Gustavo, Sue). Um motor de regras genérico pode ser *over-engineering* face a simplesmente **codificar e medir os 2 perfis reais** primeiro. Recomendação: P0/P1 com poucas regras servindo os 2 perfis reais, e só generalizar se compensar.

### 10. Decisões em aberto / fechadas
**As grandes primeiro (determinam se a feature significa algo):**
1. **Haver ou não NÚMERO pessoal** (§9) — escalar 0–100 "para si" vs só **flags + reordenação + parecer** (número só no universal). É a decisão de enquadramento mais importante; a favor de não-número joga a falsa autoridade sem oráculo. *(aberta — a mais importante)*
2. **Gate de suficiência de dados** (§5/§8 P0.5) — medir a cobertura real antes de construir o motor. *(a fazer antes de P1)*
3. ~~Limiares por condição~~ — **PROMOVIDO a requisito E ancorado (2026-06-30):** limiares **energia-relativos** das metas **OMS/PAHO**, apertados por condição com a diretriz clínica (DASH/OMS/AHA) — §4.4. Tira-os de "palpite" para "citável". *Falta:* fechar as âncoras de **bónus** (fibra/proteína/energia, ⚠️ a definir) e confirmar o nº exato da AHA (saturada p/ dislipidemia).

**Fechadas (2026-06-30):**
4. **Unidade do impacto** — em **PONTOS**, somados ao base, re-mapeados por `notaCem`; ranking e calibração em pontos (§4.1).
5. **Bloqueio de dieta/alergénio** — **bloqueio TOTAL** (não penalização), fora da ordenação (§4.5).
6. **Composição** — cap **por grupo de nutrientes concorrentes**; energia **não** é grupo próprio (é check derivado) (§4.6).
7. **Cap-proteína ↔ bónus pessoal** — base capado ⇒ bónus pessoal de proteína suprimido (§4.1).
8. **Base dos limiares** — **energia-relativa OMS/PAHO** (não o `SF_LIMIARES` front-of-pack), apertada por condição (§4.4).

**Afinação / menores:**
9. **Magnitude dos `teto_pts`** — começar suave, calibrar contra o golden do dono (§8 P3). *(aberta)*
10. **Política de exibição da confiança** — limiar de completude para mostrar a nota vs só avisos (§5). *(aberta)*
11. Onde corre o motor — servidor primeiro; cliente/`base_local` depois se compensar. *(proposta)*
12. **Ordenação** — pessoal por defeito **com *toggle*** para a universal (§6). *(proposta)*
13. **Demografia** — *como* idade/sexo/peso ajustam está **indefinido** (§5), diferido. *(aberta)*

---

## Parte IV — Especificação de cálculo COMPLETA (implementável)

> Consolida as Partes I–III num algoritmo único e sem ambiguidade — a fonte-de-verdade para implementar (P1). O universal é o que JÁ corre (`nutriscore.js`); o pessoal é a proposta. Todas as tabelas e limiares estão aqui ou referenciados.

### IV.0 Entradas
- `n` = nutrição por 100 g/ml: `{ energia_kcal, gordura_saturada, gordura, acucares, sal, fibra, proteina }` (g; energia em kcal).
- `classe` ∈ `{solido, bebida, agua, gordura}` = `classeNutriScore(familiaSlug)`.
- `perfil` (opcional) = condições/objetivos ativos + alergénios/dieta + demografia.

### IV.1 Tabelas universais (limites superiores; índice = pontos). `pts(v, T)` = nº de limites de `T` que `v` excede.
```
L_ENERGIA   = [335,670,1005,1340,1675,2010,2345,2680,3015,3350]            // kJ → 0..10
L_ACUCAR    = [3.4,6.8,10,14,17,20,24,27,31,34,37,41,44,48,51]             // g  → 0..15
L_SATURADA  = [1,2,3,4,5,6,7,8,9,10]                                       // g  → 0..10
L_SAL       = [0.2,0.4,0.6,0.8,1.0,1.2,1.4,1.6,1.8,2.0,2.2,2.4,2.6,2.8,3.0,3.2,3.4,3.6,3.8,4.0] // g → 0..20
L_FIBRA     = [3.0,4.1,5.2,6.3,7.4]                                        // g  → 0..5
L_PROTEINA  = [2.4,4.8,7.2,9.6,12,14,17]                                   // g  → 0..7
L_ENERGIA_BEB=[30,90,150,210,240,270,300,330,360,390]                     // kJ → 0..10 (bebida)
L_ACUCAR_BEB =[0.5,2,3.5,5,6,7,8,9,10,11]                                  // g  → 0..10 (bebida)
L_PROTEINA_BEB=[1.2,1.5,1.8,2.1,2.4,2.7,3.0]                              // g  → 0..7  (bebida)
L_ENERGIA_SAT=[120,240,360,480,600,720,840,960,1080,1200]                // kJ da saturada → 0..10 (gordura)
L_SAT_RATIO  =[10,16,22,28,34,40,46,52,58,64]                            // % saturada/total → 0..10 (gordura)
```

### IV.2 Passo UNIVERSAL (devolve `{pontos, grau, nota100}` ou `null`)
1. **Exigências/guardas (Parte II):** `null` se faltar `energia_kcal` ou `gordura_saturada`. Se `classe=gordura`: `null` se `gordura` ausente/≤0. Senão (sólido/bebida): `null` se faltar `acucares` ou `sal`. `null` se **qualquer macro < 0** ou **saturada > gordura total**. *(óleo: açúcar/sal ausentes assumem 0.)*
2. **Negativos `A`:**
   - `gordura`: `A = pts(sat×37, L_ENERGIA_SAT) + pts(sat/gordura×100, L_SAT_RATIO) + pts(acucares, L_ACUCAR) + pts(sal, L_SAL)`
   - sólido/bebida: `A = pts(energia_kcal×4.184, L_ENERGIA[_BEB]) + pts(acucares, L_ACUCAR[_BEB]) + pts(sat, L_SATURADA) + pts(sal, L_SAL)`
3. **Positivos:** `ptFibra = pts(fibra, L_FIBRA)`; `ptProt = pts(proteina, L_PROTEINA[_BEB])`.
4. **Cap da proteína:** `cap = (classe=gordura ? 7 : 11)`. `pontos = (A ≥ cap && fruta<5) ? A − ptFibra : A − ptFibra − ptProt`. (fruta = 0, ver Limitação 1.) **Guardar `capAtivo = (A ≥ cap)`** para a camada pessoal.
5. **Grau:** água→A; bebida→`≤2 B,≤6 C,≤9 D, senão E`; gordura→`≤−6 A,≤2 B,≤10 C,≤18 D, senão E`; sólido→`≤0 A,≤2 B,≤10 C,≤18 D, senão E`.
6. **`nota100 = notaCem(pontos, classe)`** — interpolação linear-por-troços, `Y=[100,80,60,40,20,0]` sobre breakpoints: sólido `[-15,0,2,10,18,40]`, gordura `[-15,-6,2,10,18,40]`, bebida `[-2,2,6,9,13]`+`Y=[80,60,40,20,0]`, água→100.

### IV.3 Passo PESSOAL (devolve `pessoal` + `motivos` + `confianca` + `bloqueio`, ou suprime)
> Corre **só se** o universal deu `pontos_base ≠ null`. Tudo em **PONTOS**, somado ao base.

1. **Bloqueios duros (binários, antes de tudo):** alergénio do perfil na ficha **ou** incompatibilidade de dieta → `bloqueio` preenchido, **sem nota pessoal**, fora da ordenação.
2. **DRC no perfil → suprimir nota pessoal**, só `alertas` textuais (§4.4 ⚠️).
3. **Métricas energia-relativas** do produto: `%E_sat = sat×37 / (kcal×4.184) ×100`; `%E_sug = acucares×17 / (kcal×4.184) ×100`; `%E_prot = proteina×17 / (kcal×4.184) ×100`; `Na_mg_kcal = sal×400 / kcal`; `dens = kcal` (por 100 g).
4. **Para cada regra ativa** (tabela §4.4, limiares já apertados por condição): `impacto_pts = dir × teto × clamp((valor − seguro)/(alto − seguro), 0, 1)`. `dir=+1` penaliza, `−1` bonifica. **Se `capAtivo` e a regra é o bónus de proteína → impacto = 0** (não re-creditar o que o cap recusou, §4.1).
5. **Composição:** somar os `impacto_pts`, com **cap por grupo concorrente** (sódio / açúcares / gorduras) — a energia é check derivado, não grupo. `pontos_pessoal = clamp(pontos_base + Σ impacto, faixa válida da classe)`.
6. **`grau`/`nota100` pessoal** = mesmas funções do passo IV.2.5–6 sobre `pontos_pessoal`.
7. **Confiança** `= {presentes, relevantes}` = quantos dos nutrientes que as regras ativas usam estão presentes em `n`. Política de exibição: §10.10. Se um nutriente crítico falta → `alerta`, e a regra correspondente não dispara.

### IV.4 Dois exemplos ponta-a-ponta (com a matemática)
**A. Queijo salgado para um HIPERTENSO** — `n = {kcal 350, sat 18, gordura 28, acucares 1, sal 1.8, fibra 0, proteina 22}`, classe sólido.
- Universal: kJ 1464→**4**; açúcar 1→0; sat 18→**10**; sal 1.8→**8** ⇒ `A=22`. `A≥11` ⇒ proteína não conta; `pontos_base = 22 − 0 = 22` ⇒ **E**, `nota100 = 16`. `capAtivo=true`.
- Pessoal (sódio): `Na_mg_kcal = 1.8×400/350 = 2.06`; regra hipertensão `seguro 0.375 → alto 0.75`; `2.06 > 0.75` ⇒ clamp 1 ⇒ `impacto = +1×8×1 = +8`. `pontos_pessoal = 30` ⇒ **E**, `nota100 = 9`. `delta_pts = +8`. Motivo: "sódio 2,06 mg/kcal ≫ 0,75 → +8". Confiança 1/1.
- Leitura: já era E; para si é **ainda pior** (16→9) — o sódio domina.

**B. Cereal açucarado para um DIABÉTICO** — `n = {kcal 380, sat 1, gordura 3, acucares 22, sal 0.4, fibra 6, proteina 8}`, classe sólido.
- Universal: kJ 1590→**4**; açúcar 22→**6**; sat 1→0; sal 0.4→**1** ⇒ `A=11`. `A≥11` ⇒ proteína não conta; fibra 6→3; `pontos_base = 11 − 3 = 8` ⇒ **C**, `nota100 = 45`. `capAtivo=true`.
- Pessoal (açúcar): `%E_sug = 22×17/1590×100 = 23.5`; regra diabetes `seguro 2.5 → alto 5`; `23.5 > 5` ⇒ clamp 1 ⇒ `impacto = +8`. `pontos_pessoal = 16` ⇒ **D**, `nota100 = 25`. `delta_pts = +8`. Motivo: "açúcar 23,5 %E ≫ 5 %E → +8 (C→D)". Confiança 1/1.
- Leitura: universal **C** mas para o diabético desce a **D** — o açúcar pesa-lhe mais, e a régua exprime-o.

> **Estado:** o **universal (IV.1–IV.2) está implementado e em produção** (`nutriscore.js`, 15 testes). O **pessoal (IV.3) é especificação** — pronto para P0/P1 (tabela de regras em config + motor puro + golden de perfis), **depois** do gate de suficiência de dados (§8 P0.5) e da decisão "haver número?" (§10.1).

---

### Fontes (literatura) — estado de verificação
> Política: **só se cita o que foi verificado**; o que ainda não foi está marcado ⚠️ *a confirmar* e NÃO deve ser apresentado como autoridade até verificação.

**Verificadas (2026-06-30, pesquisa direta):**
- **Algoritmo oficial 2023** — Merz et al., *Nutri-Score 2023 update*, **Nature Food** 5, 102–110 (2024): [nature.com/articles/s43016-024-00920-3](https://www.nature.com/articles/s43016-024-00920-3). Confirma açúcar/sal mais severos e "água = única bebida A".
- **Fórmulas FSA-NPS 2023** (escala de gorduras: rácio saturada/total, `SFA×37 kJ/g`, exclusão de proteína quando N≥7): [eclarion.com/nutriscore-calculator/methodology](https://www.eclarion.com/nutriscore-calculator/methodology/).
- **Modelo de Perfil de Nutrientes PAHO/WHO** (cutoffs de "excesso" energia-relativos, base = metas de ingestão OMS ajustadas à energia): [paho.org/en/nutrient-profile-model](https://www.paho.org/en/nutrient-profile-model) + ["PAHO defines excess levels…"](https://www.paho.org/en/news/19-2-2016-paho-defines-excess-levels-sugar-salt-and-fat-processed-food-and-drink-products-0). Cutoffs: açúcar ≥10 %E · saturada ≥10 %E · gordura total ≥30 %E · trans ≥1 %E · sódio ≥1 mg/kcal.
- **Metas OMS** (adultos): açúcares livres <10 %E (ideal <5 %E); saturada <10 %E; sódio <2 g/dia (<5 g sal): [who.int/news/item/17-07-2023](https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates).
- **DASH baixo-sódio 1500 mg/dia para hipertensão** — StatPearls: [ncbi.nlm.nih.gov/books/NBK482514](https://www.ncbi.nlm.nih.gov/books/NBK482514/).
- **AHA — saturada <5–6 %E para baixar LDL** (dislipidemia): [heart.org · Saturated Fats](https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/fats/saturated-fats).
- **Claims UE 1924/2006** (bónus fibra/proteína): "fonte de fibra" ≥3 g/100 g, "alto teor" ≥6 g/100 g; "fonte de proteína" ≥12 %E, "alto teor" ≥20 %E: [EUR-Lex 32006R1924](https://eur-lex.europa.eu/eli/reg/2006/1924/oj/eng).
- **Densidade energética (Rolls 2003)** — médio 151–225, alto 226–400 kcal/100 g (objetivo perda de peso): categorias amplamente usadas em gestão de peso (ver [CDC low-energy-dense foods](https://www.k-state.edu/fns/assets/course_3/dont_lost_your_balance/appendices/APPENDIX%203-%20CDC%20Article%20Low%20Energy%20Dense%20Foods.pdf)).

**⚠️ A confirmar antes de citar como autoridade** (vieram da síntese, ainda não verificadas uma a uma): completude do OFF "~67 % macros" (estudo 2021); modelos PFS / Nestlé-NNA / PepsiCo-PNC (existência + uso de rampa graduada); "Chile +15 % adoçantes não-nutritivos"; "DASH contraindicado em DRC" (afirmação clínica geral plausível, mas falta a fonte primária); crítica ao NOVA em *Proceedings of the Nutrition Society* (2025).

> **Enquadramento honesto:** estas fontes **ancoram** os limiares (tira-os de "palpite do dono" para "diretriz citável"), mas **não dão um oráculo de saúde** para os nossos `teto_pts` por condição — esses validam-se contra o golden do dono (§9). Âncora ≠ validação de desfecho.

---

### Apêndice — referências de código
- `backend/src/normaliza/nutriscore.js` — `nutriScore()`, `notaCem()`, tabelas.
- `backend/src/normaliza/familia.js` — `classeNutriScore()`.
- `backend/src/routes/produto.js` — `/info` chama `nutriScore` e devolve `nutriscore_calc`.
- `backend/test/nutriscore.test.mjs` — 15 testes (escalas, dados em falta, plausibilidade, nota 0–100).
- Perfil: editor v2 `PerfilSaude`, `perfil_membro.saude_estado` (migr. 066), `perfilParaTexto`.
- Contexto: [`Visao_Conselheiro_Saude_Alimentar.md`](Visao_Conselheiro_Saude_Alimentar.md).

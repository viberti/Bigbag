# Nutrição canónica para commodities — design (1)

> **Problema a resolver:** produtos que são **a mesma comida genérica** (ovos de galinha, leite meio-gordo, açúcar, farinha, arroz, carnes/peixes frescos) deviam ter **UMA** nutrição e **UMA** nota Nutri-Score — mas têm nota dispersa porque usamos a nutrição **por-EAN de cada marca** (com lacunas e erros). Decisão do dono (2026-06-30): *"todos os ovos do mesmo animal deviam ter o mesmo Nutri-Score, salvo qualificador no nome"*.
>
> Complementa o fix **(2)** já feito (açúcar em falta = 0 p/ alimento sem açúcar): o (2) faz os ovos **terem** nota; o (1) faz **todos terem a MESMA** nota. Ainda **não implementado** — este é o desenho.

## 1. Evidência (medida)
Depois do (2), os **ovos** (familia `ovos`, 328 produtos) têm nota mas **dispersa de D(35) a A(85)** — a mesma comida, notas diferentes, por variação dos dados por-marca. O mesmo padrão em `leite meio-gordo`, `gouda`, etc. (auditoria por nome: ~131 grupos com gap ≥35). A nutrição canónica do ovo (TACO *"Ovo, de galinha, inteiro, cru"*: 143 kcal, 8,9 g gord, 2,6 g sat, 0,42 g sal, açúcar≈0) dá **A (~80)** — a nota correta a que todos deviam convergir.

## 2. Princípio
Uma **commodity** (alimento genérico de perfil fixo) tem um **perfil nutricional canónico**. Para esses produtos, a nutrição **autoritativa** (TACO > FAO > USDA — o matcher `nutricaoGenerica` em `normaliza/taco.js` que já existe) deve **vencer** a nutrição retail por-marca → uma nutrição → uma nota. **Não** é assumir que todas as marcas são iguais; é reconhecer que para uma commodity SEM qualificador, a variação entre marcas é **ruído de dados**, não diferença real.

## 3. Desenho
### 3.1 TIERS de canonicalizabilidade (correção 2026-06-30 — não tratar todas as famílias como iguais)
Nem toda a "commodity" é igualmente segura para forçar um perfil único. Estratifica-se:
- **Tier 1 — força canónico agressivamente** (perfil quase invariante; variação entre marcas ≈ ruído de medição): `ovos`, `farinha_acucar` (açúcar/farinha simples), `arroz` **por variante** (branco/integral, seco), `massa` seca **por variante**. Aqui o canónico vence **tudo exceto `manual`** (§6.1).
- **Tier 2 — só com QUALIFICADOR de teor/forma** (perfil multimodal mas estruturado): `leite` (meio-gordo/magro/gordo), `leguminosas` (seco vs conserva), `iogurte` (natural). Canónico **por variante**; o **fabricante-confirmado vence** (§6.1).
- **Tier 3 — NÃO forçar (só VALIDADOR, §3.6)**: `carnes` (o corte move a saturada — lombo vs moída 20% vs coxa-com-pele; o qualificador não captura), `peixes`, `azeite`/`oleo` (a escala de gorduras existe para separar azeite ~14% sat de coco ~87% — um descritor único achata o próprio sinal), `queijos` (gouda meio-gordo sem "light" → perfil errado + sobrescreve dado bom). A variação real é grande demais para o sistema de qualificador.
> *NÃO* commodity de todo: doces, bolachas, refrigerantes, pratos preparados, charcutaria.
> **Valor:** o P0 encolhe — não é preciso curar tudo; só o **Tier 1** (as famílias que mais dispersam e mais seguras) já entrega o grosso da consistência.

### 3.2 Mapa família(+variante) → descritor canónico — pela forma VENDIDA
Por família/variante, o descritor TACO/USDA. **REGRA DURA: o descritor é a forma COMO VENDIDA, não a preparada** — a nota calcula-se sobre os 100 g do rótulo. Arroz/massa/feijão vendem-se **secos** (~350 kcal), não cozidos (~130) — usar "cozido" subestima a energia ~2,7× → nota falsamente boa e incoerente com o rótulo. Ovos/carne/peixe frescos vendem-se **crus** → "cru" certo.
- `ovos` → "Ovo, de galinha, inteiro, **cru**"; `arroz` branco → "Arroz, polido, **cru**"; `feijao` → "Feijão, …, **cru**" (conserva é OUTRA variante).
Curado em `data/nutricao_canonica.json`, revisto pelo dono; nutrição vinda da `nutricao_taco`/USDA.

### 3.3 QUALIFICADOR no nome (a parte fina) — inclui SECO-vs-CONSERVA
A chave canónica é **família + qualificador**; sem o qualificador certo, NÃO se força:
- **Teor:** leite *meio-gordo*/*magro*/*gordo*; arroz *branco*/*integral*; iogurte *natural*/*açucarado*.
- **FORMA (1.ª classe):** **seco vs conserva/lata vs cozido** — feijão seco (~330 kcal) e feijão em lata (~90–120, com água+sal) são produtos diferentes no per-100g. Tão importante como o teor.
- **Enriquecimento/processo:** ovos *ómega-3*; *enriquecido*; *light*; *frito* → mantém a nutrição própria (não força).
- Detecção por palavras-chave (reusa `familia.js`/`categoria.js`).

### 3.4 Onde no pipeline
No **fusor** (`fichaEan.js`), acrescenta-se uma fonte **`canonico`**. A prioridade depende do **tier** (§6.1): **Tier 1** → canónico vence tudo exceto `manual`; **Tier 2** → o fabricante-confirmado vence, o canónico só bate OFF/VLM/estimativa. Proveniência em `fusao` (auditável, reversível). Idempotente.

### 3.5 Combina com o (2)
A TACO **não traz açúcar** → a nutrição canónica do ovo tem açúcar=null. O fix (2) (`acucarAssumivelZero`) faz isso virar 0 → a nota canónica calcula. As duas peças juntas: **todos os ovos de galinha → A (80)**.

### 3.6 O canónico como VALIDADOR (provavelmente vale mais que o override)
Mesmo onde o canónico **não vence** (Tier 2/3, ou quando o confirmado ganha), **calcula-se sempre** e sinaliza-se quem diverge dele acima de um limiar (ex.: energia >25 % OU saturada >2×) → vira um **tripwire de qualidade de dados**. Apanha o que o override não toca: o "ovo confirmado com açúcar 50 g" (typo no catálogo 047 — confirmado **não** é sinónimo de correto), o gouda-light mal classificado, o azeite com perfil de óleo. É barato (o canónico já está calculado) e cobre o **Tier 2/3 sem o risco de os achatar**.
> **Cuidado herdado:** o validador tem de comparar com a **variante CERTA** (§3.3) — comparar um leite-magro ao canónico do meio-gordo dá falso-positivo. Sem o qualificador, o validador recria o ruído que quer apanhar.
> **Não é um silo:** a divergência-do-canónico é mais um **sinal de suspeita** que alimenta a MESMA fila do envelope-de-família (C2) e da auditoria LLM (`nutricao_auditoria`) — integra-se aí, não cria pipeline novo.

## 4. Riscos e mitigação
- **Falso canónico:** um "leite" que é bebida láctea açucarada levaria o perfil de leite simples (errado). → Mitiga: só famílias estritamente commodity + exceção de qualificador rigorosa; em dúvida, NÃO força canónico (mantém retail).
- **Forma errada** (cru vs cozido, pó vs líquido): o descritor canónico tem de bater com a forma vendida. → o qualificador de forma no nome seleciona o descritor; sem certeza, não força.
- **Apagar dados reais:** nunca se ALTERA a nutrição retail guardada; o canónico é uma **fonte na fusão** (a retail fica, só perde a votação). Reversível.
- **Quantidade/locale:** a nota usa por-100g; a TACO já é por-100g. OK.

## 5. Faseamento
- **P0** — `data/nutricao_canonica.json`: mapa família(+variante/forma) → descritor TACO/USDA, **só com a forma VENDIDA** (seco/cru). Tabela de famílias por **tier** (§3.1). Revisto pelo dono. Começa pelo **Tier 1** (encolhe o âmbito ao seguro).
- **P1** — `nutricaoCanonica(familia, nome)` (puro, testável): devolve a variante canónica ou null (null quando há qualificador/forma incerta, ou família Tier 3). Golden: ovo, leite meio-gordo vs magro, feijão seco vs lata, arroz integral, ómega-3 não força, azeite≠óleo.
- **P1.5 — VALIDADOR primeiro (§3.6):** ligar a divergência-do-canónico como sinal na fila de suspeita (C2/auditoria LLM) **para TODOS os tiers**. Entrega valor (apanha typos do confirmado) **antes e sem** o risco do override. Provavelmente a peça de maior ROI.
- **P2 — override, só Tier 1+2:** ligar a fonte `canonico` no fusor com a prioridade por tier (§6.1). Re-fundir (`refundir_fichas`) + re-materializar `ns_*`.
- **P3 — validar nos DOIS sentidos:** (a) a dispersão "mesmo nome" deve **colapsar** nas commodities (ovos→A/B); (b) **auditoria de CORREÇÃO** — numa amostra dos grupos colapsados, confirmar à mão que nenhum produto genuinamente diferente foi achatado (um queijo-light empurrado p/ gordo conta como colapso FALSO). Medir só a redução premiaria esconder diferença real.

## 6. Decisões (dono)
1. **Canónico vs fabricante-confirmado — AMARRADO AO TIER (não global):** os dois princípios estão em tensão — "uma commodity, uma nota" (consistência) vs "respeitar o dado confirmado". Proposta: **Tier 1 → canónico vence até o confirmado** (a diferença entre marcas de ovo simples está no erro de medição; a consistência vale mais); **Tier 2/3 → o confirmado vence** (a variação pode ser real). Nota dura: **confirmado ≠ correto** (o catálogo 047 também tem typos) → por isso o **validador (§3.6) corre sempre**, mesmo sobre o confirmado. *(proposta, a confirmar)*
2. **Âmbito do qualificador/forma:** lista exata dos qualificadores que "quebram" o canónico (teor + **forma seco/conserva/cozido** + enriquecimento) — começar restrito, alargar com casos. *(aberta)*
3. **Fonte canónica BR vs PT:** TACO é BR; para PT-PT há o INSA. Por agora TACO/USDA cobrem o genérico; INSA fica para depois. *(proposta: TACO/USDA já chega)*

---
### Referências de código
- `backend/src/normaliza/taco.js` — `nutricaoGenerica` (matcher TACO/FAO/USDA já existente).
- `backend/src/normaliza/familia.js` — `acucarAssumivelZero` (fix 2), famílias.
- `backend/src/normaliza/fichaEan.js` — fusor (onde entra a fonte `canonico`).
- `backend/scripts/calcular_nutriscore_base_local.mjs` — re-materializa `ns_*` após.
- Contexto: [`Nutri_Score_Calculo_e_Personalizacao.md`](Nutri_Score_Calculo_e_Personalizacao.md), [`Normalizacao.md`](Normalizacao.md).

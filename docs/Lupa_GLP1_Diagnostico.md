# Lupa GLP-1 — diagnóstico de coleta (Ozempic, Mounjaro, genéricos oficiais)

> Diagnóstico **read-only** (2026-06-23): AO VIVO (adaptadores de PRODUÇÃO, `scripts/lupa_glp1.mjs`)
> vs BANCO, por (EAN × fonte). Nada foi alterado. Apenas FLAG, sem conserto. CEP ref 22241-040.

---

## STEP 0 — Grade canônica (classificação ANVISA, `cmed_versao` Qua 10-Jun-2026)

**Genéricos oficiais HOJE: ZERO** em ambas as moléculas.
- SEMAGLUTIDA: **0 genéricos** / 34 registros · TIRZEPATIDA: **0 genéricos** / 24 registros.

**REFERÊNCIA** (a grade dos Steps 1-2 = referência **com oferta**):
- **OZEMPIC** (tipo=Biológico, gen=0): 4 EANs; com oferta: `7897705202548`, `7897705202586`.
- **MOUNJARO** (tipo=Novo, gen=0): 24 EANs; com oferta: `7896382709111/135/159/173/197/210`.

**AMBÍGUOS** (semaglutida/tirzepatida que NÃO são genérico nem a referência — como a ANVISA os classifica):
`OZIVY` (tipo=**Novo**), `POVIZTRA` `WEGOVY` `EXTENSIOR` `RYBELSUS` (tipo=**Biológico**). **Nenhum é "Genérico"** — são biossimilares/novos. (Ficam fora da grade, conforme pedido.)

**⚠️ Achados de dado no Step 0 (CMED, flag):**
- **`qtd_embalagem=0` em TODOS os 24 Mounjaro** (não parseado).
- **EANs suspeitos** no Mounjaro: `7906382709537`, `7916382709544`, `7926382709551`, `7936382709568`, `7946382709575` — o 3.º dígito incrementa 0/1/2/3/4 (provável artefacto de multi-EAN da CMED / dígito trocado). **Nenhum tem oferta** → não afeta a coleta de hoje, mas são identidade duvidosa.
- Mounjaro tem **vários registros por mesma dose** com PMC muito diferentes (ex.: dose 5MG/ML com PMC 654,12 / 1927,21 / 2616,50 / 3854,43) — relaciona-se com o "PMC-de-pack-errado" (Cluster 3).

---

## STEP 1 — Fidelidade AO VIVO vs BANCO (reconciliação)

**Veredito global: fidelidade EXCELENTE.** Em todas as células com live+banco, o `preco` armazenado
é **idêntico ao centavo** ao que o adaptador de produção devolve agora. Resumo (8 EANs × 23 fontes):

| Status | Contagem | Nota |
|---|--:|---|
| **MATCH** (preço idêntico) | ~120 | todas as VTEX + panvel + nissei com linha |
| **NÃO-VENDE** | ~25 | fonte não carrega o EAN (correto) |
| **SEM-ADAPTADOR-AO-VIVO** | 24 | drogasil/drogaraia (raiadrogasil) + minasbrasil (jsonld) — **e sem linha de harvest p/ estes EANs** |
| **DIVERGE — drogariamoderna (live-tem/banco-não)** | 3 | vende Mounjaro live, **sem linha no banco** (ver severidade) |
| **DIVERGE — araujo (live-não)** | 8 | **transiente** (colheita ampla a correr → defesa do host); chamada isolada = MATCH |
| **ESGOTADO detetado** (live=null/esgotado) | 3 | farmaconde 709197/709210, catarinense 709210 — **guard a funcionar** |

**Confirmações importantes:**
- **Zero sentinela no banco** para estes EANs (`⚠SENTINELA` não apareceu em nenhuma célula) → a limpeza do Cluster 1 segurou.
- **Estoque ao vivo correto:** os ESGOTADO devolvem `preco=null`+`disponivel=false` (NÃO 99999) → o guard de disponibilidade do Cluster 1 está ativo.
- **Condicional↔normal (caso Araújo):** o nosso `preco` casa com o **NORMAL** ao vivo (Araújo R$1.314,38), nunca com o promocional (R$999) — a separação está correta em todas as células com condicional.

---

## STEP 2 — Cobertura do desconto de laboratório (PBM)

Matriz (todas as fontes têm `tem_tabela=sim` quando vendem; colunas relevantes):

| Fonte | vende GLP-1 | preço tabela | **condicional (PBM)** | programa nomeado | valor cond. exemplo (Ozempic 1mg) |
|---|:--:|:--:|:--:|:--:|--:|
| **panvel** | ✅ | ✅ | ✅ | "1ª Compra" (rótulo) | R$998,97 (−23%) |
| **araujo** | ✅ | ✅ | ✅ | "Desconto do laboratório (PBM)" | R$999 (−24%) |
| 15× VTEX (paguemenos…pacheco) | ✅ | ✅ | ❌ | — | — |
| nissei | ✅ | ✅ | ❌ (gated por CPF) | — | — |
| drogasil/drogaraia/minasbrasil | sem dado | — | ❌ | — | — |

**Ponto cego (enumerado):**
- **17 fontes vendem mas NÃO expõem condicional** (todas as VTEX + nissei).
- **Estrutural:** o desconto de balcão atrelado a **CPF** (NovoDia p/ semaglutida; Lilly Melhor Para Você p/ tirzepatida) **nunca está na página** — só panvel/araujo publicam um valor PBM aberto; o resto exige cadastro/CPF (não capturável).
- **Plausibilidade:** os condicionais publicados são compatíveis com o programa esperado — Ozempic −23/24% (NovoDia), Mounjaro −41% (panvel R$1.125 vs R$1.905 na 2,5mg; Lilly). Não parecem outra promoção.

---

## STEP 3 — Perfil de confiabilidade por fonte (para estes remédios)

| Fonte(s) | Carrega? | Fiel ao vivo? | Estoque real? | Condicional? | Adaptador ao-vivo | Veredito |
|---|:--:|:--:|:--:|:--:|:--:|---|
| 15× VTEX nacionais | ✅ | ✅ idêntico | ✅ (qtd/disp) | ❌ | ✅ precoEstoqueVtex | **Alta confiança** |
| pacheco / drogariasaopaulo (geo) | ✅ | ✅ | ✅ | ❌ | ✅ (via proxy) | **Alta** |
| panvel | ✅ | ✅ | ❌ | ✅ rotulado | ✅ | **Alta** (+PBM) |
| nissei | ✅ | ✅ | ❌ | ❌ (gated) | ✅ | **Alta** |
| araujo | ✅ | ✅ (isolado) | ❌ | ✅ rotulado | ⚠️ frágil sob carga | **Média** — adaptador aborta na defesa do host; dado plausível |
| drogasil / drogaraia | sem dado | n/a | n/a | ❌ | ❌ SEM-ADAPTADOR | **Lacuna** — sem verificação por-EAN nem dado destes GLP-1 |
| minasbrasil | sem dado | n/a | n/a | ❌ | ❌ (jsonld) | **Lacuna** |
| drogariamoderna | parcial | ⚠️ | — | ❌ | ✅ | **Baixa** — vende live mas falta linha no banco |

---

## DIVERGÊNCIAS ranqueadas por severidade

1. **[MÉDIA] Força clínica não-estruturada (todos os injetáveis) + EAN ambíguo do Ozempic starter.**
   O `dose_valor` é a **concentração** (MG/ML), não a força clínica. O cross-check entre fontes
   resolveu as forças autoritativas (ver §6). **`7897705202548` (Ozempic starter) aparece rotulado
   como "0,25mg" em ~12 fontes e "0,5mg" em ~7** — é a caneta de titulação **0,25/0,5 mg** (dose
   dupla), não EAN errado; mas o parse-pelo-nome é ambíguo → precisa de força **curada**. (Cluster 2.)
2. **[MÉDIA] drogariamoderna vende Mounjaro AO VIVO mais barato, sem linha no banco.**
   `709111`→R$1.662,76 · `709135`→R$2.078,65 · `709173`→R$2.801,67 (mais baratos que o nosso mínimo
   atual ~R$1.900/2.150/2.930). **Ofertas mais baratas em falta** no catálogo. Liga-se à nota (a) do
   Cluster 1 (drogariamoderna instável) — precisa de re-harvest.
3. **[BAIXA] araujo "live-não" em todos os 8 — transiente, não defeito.** A colheita ampla da araujo
   estava a correr; a chamada isolada devolveu MATCH perfeito. **Fragilidade do adaptador sob carga
   concorrente** (aborta na defesa do host), não erro de dado.
4. **[BAIXA/estrutural] SEM-ADAPTADOR-AO-VIVO: drogasil, drogaraia, minasbrasil.** Sem busca por-EAN
   única → não dá para live-verificar; e não têm dados destes GLP-1 (drogasil/RD são EAN-driven por
   JSON-LD; estes EANs não foram colhidos). Lacuna de verificação + cobertura.
5. **[informativo] PBM só em panvel+araujo; desconto por CPF nunca na página** (ponto cego estrutural).
6. **[informativo, Step 0] EANs suspeitos do Mounjaro (790x/791x…) + qtd_embalagem=0** — identidade
   duvidosa na CMED, mas sem oferta hoje.

---

## STEP 6 — Força clínica autoritativa por EAN (do cross-check entre fontes)

A força lida do nome ao vivo é **consistente entre todas as fontes** (exceto o starter do Ozempic),
o que dá os valores autoritativos para uma futura coluna curada (Cluster 2):

| EAN | Produto | dose_valor (CMED, concentração) | **Força clínica autoritativa** | Consistência entre fontes |
|---|---|---|---|---|
| 7897705202548 | Ozempic starter | 1,34 MG/ML | **0,25 / 0,5 mg** (caneta dupla) | ⚠️ rotulada como 0,25 OU 0,5 → **curar** |
| 7897705202586 | Ozempic | 1,34 MG/ML | **1 mg** | ✅ 100% |
| 7896382709111 | Mounjaro | 5 MG/ML | **2,5 mg** | ✅ 100% |
| 7896382709135 | Mounjaro | 10 MG/ML | **5 mg** | ✅ 100% |
| 7896382709159 | Mounjaro | 15 MG/ML | **7,5 mg** | ✅ 100% |
| 7896382709173 | Mounjaro | 20 MG/ML | **10 mg** | ✅ 100% |
| 7896382709197 | Mounjaro | 25 MG/ML | **12,5 mg** | ✅ 100% |
| 7896382709210 | Mounjaro | 30 MG/ML | **15 mg** | ✅ 100% |

> Padrão Mounjaro: a **concentração (mg/ml) = 2× a força clínica** (injeção de 0,5 ml). Só o
> `7897705202548` precisa de curadoria (nome ambíguo); os outros 7 têm força autoritativa unânime.

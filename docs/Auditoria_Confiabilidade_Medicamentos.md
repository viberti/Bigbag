# Auditoria de confiabilidade — Vertical de Medicamentos (BigBag)

> Resultados reais da auditoria read-only (`backend/scripts/auditoria_remedios.mjs`), rodada
> contra a BD ao vivo `app_bigbag` em **2026-06-23**. Objetivo: transformar as anedotas do
> inventário em **taxas**, para decidir a ordem dos consertos com número, não por chute.
> *(Snapshot pontual — re-correr o script para re-medir.)*

**Denominadores:** 369.588 ofertas BRL com preço · 116.966 EANs · **59 fontes** · 26.353 itens
de identidade (CMED) · histórico de preço de 2026-06-08 a 2026-06-23.

> ⚠️ **Ressalva que muda a leitura de tudo:** o escopo `moeda='BRL'` **não é só farmácia** —
> inclui **~30 SUPERMERCADOS brasileiros** (paodeacucar, zaffari, supernosso, gbarbosa, condor,
> atacadao…) que pertencem à vertical de **mercearia**, não a remédios. Vários números só fazem
> sentido depois de separar farmácia de supermercado.

---

## A. Identidade — o produto é o que dizemos que é?

### A.1 / A.2 — Órfãos (oferta com preço, sem match por EAN na CMED)
Agregado: **104.570 EANs / 267.857 linhas** sem identidade. **O número engana** — ~30 fontes a
**100% órfãs são supermercados** (EANs de mercearia, nunca estarão na CMED). O retrato **só-farmácia**:

| Farmácia | % órfãos | Leitura |
|---|--:|---|
| panvel, drogasil, drogaraia, nissei, araujo | **0%** | adaptadores EAN-driven (só buscam EAN já conhecido) |
| drogal, pacheco, drogariasaopaulo | 2–4% | VTEX "limpas" |
| catarinense, venancio, globo, saojoao, farmagora, precopopular | 15–22% | VTEX varre a loja toda (cosmético/higiene não-CMED) |
| **paguemenos, extrafarma** | **50,3%** | metade do que colhem **não é medicamento** (ou EAN fora da CMED) |

→ Os adaptadores novos são perfeitos; os **harvesters VTEX varrem a loja inteira** e ~15–50% do
que trazem não é remédio.

### A.3 [CRÍTICO] — Colapso de força (baldes de equivalência GLP-1)
Confirmado, mas **localizado**:
- **SEMAGLUTIDA injetável → 16 EANs num só balde** (`1,34 MG/ML solução`) e **LIRAGLUTIDA
  injetável → 15 EANs** (`6 MG/ML`). Aqui a equivalência **mistura forças clínicas diferentes**
  (Ozempic 0,25/0,5/1/2mg juntos).
- **TIRZEPATIDA está CORRETA** — cada força = concentração própria (5/10/15/20/25/30 MG/ML → baldes de 4).
- **Semaglutida ORAL (Rybelsus) está CORRETA** — 3/7/14 MG → baldes separados.

```
substancia   dose_valor  forma       eans_no_balde
SEMAGLUTIDA   1.34 MG/ML  solução     16   ← COLAPSO (forças clínicas diferentes juntas)
LIRAGLUTIDA   6    MG/ML  solução     15   ← COLAPSO
SEMAGLUTIDA   3/7/14 MG   comprimido  4    ← ok (oral, força = dose_valor)
TIRZEPATIDA   5..30 MG/ML solução     4    ← ok (cada força = concentração própria)
```

### A.4 [a sonda decisiva] — a força clínica NÃO está em campo oficial
O `apresentacao` da CMED traz só **concentração + volume**; `raw IS NULL`. Exemplo real:
```
LIRUX   6 MG/ML  qtd=3   "6 MG/ML SOL INJ SC CT CAR VD TRANS X 3 ML + CAN APLIC"        tem_raw=0
SAXENDA 6 MG/ML  qtd=1   "6 MG/ML SOL INJ CT X 1 CAR VD TRANS X 3 ML X 1 SIST APLIC PL"  tem_raw=0
```
Para semaglutida/liraglutida **injetável não existe "força clínica" estruturada na ANVISA** — o
"1mg/semana" é convenção de bula da Novo Nordisk, presente só no **nome raspado**. Logo o conserto
desse balde é **parse do nome** (ou tabela curada de força por registro), **não** um campo oficial.

### A.6 — Grafia da molécula (match string-exato hoje)
Limpa para GLP-1: SEMAGLUTIDA 34 EANs, TIRZEPATIDA 24, LIRAGLUTIDA 15, +combo
`LIRAGLUTIDA;INSULINA DEGLUDECA` 3 (Xultophy, corretamente separado). O match exato **não está
fragmentando** esta família hoje (risco futuro com genéricos de grafia variante).

---

## B. Preço — o número é o preço real de prateleira?

### B.1 / B.2 — Desconto condicional (PBM)
Capturado só por **araujo (26/26) e panvel (24)** — as únicas que publicam o valor. Desconto médio
**~30%**, máx **~59%**; **zero anomalias** (`preco_cond > preco` = 0). As outras 57 fontes = 0
(correto: não expõem). *(araujo 100% porque só tem os 26 EANs da classe; colheita ampla em curso.)*

### B.3 [CRÍTICO] — Preços ACIMA do teto legal (PMC): 2.113 / 100.858 = **2,1%**
**Causa dominante identificada:** os piores ofensores são **todos `drogariamoderna` com
`preco=99999`** — o **sentinela "indisponível" do VTEX vazou para o CATÁLOGO**. O caminho ao-vivo
filtra 99999; **o caminho do harvest NÃO filtra** → grava o sentinela como preço real. Bug
**concreto e localizado** (não é PMC desatualizado). Amostra:
```
drogariamoderna  Clor.Metoclop. Gotas   preco=99999  pmc_18=7.77   (+1.286.888%)
drogariamoderna  Tylalgin Gts 15ml      preco=99999  pmc_18=8.64   (+1.157.296%)
```

### B.4 — Baixos demais (<50% do teto)
Mistura de (a) **placeholders de centavo** (`0,01`, `0,69`) e (b) **PMC trocado de pack** — ex.:
"Anador 500mg **com 4**" com `pmc_18=743,31` (o teto é do pack de **128 blísteres**, colado ao EAN
de 4 comprimidos). O **preço** (5,45) está certo; o **teto** é que casou com a apresentação errada.

### B.5 — Saltos no histórico on-change (razão ≥ 1.25)
O topo é **mercearia + sentinelas** (extra/condor/apoio com `999999`/`99999` e linhas de `ean`
vazio). Ruído de supermercado, não de farmácia.

---

## C. Frescor e cobertura — o preço é de agora?

### C.1 — Idade dos preços de remédio (entre os 101.731 casados)
```
< 6h: 6.314    |  7–24h: 72.783  |  1–7d: 22.622  |  > 7d: 12
```
→ ~78% < 24h. A cadência semanal faz o grosso ter ~24h.

### C.2 — Saúde por fonte
**Nenhuma farmácia morreu calada:** as 23 farmácias coletaram nas últimas **≤25h** (as novas
panvel/nissei/araujo, 1–3h). As fontes com 125–172h de idade são **supermercados** (irrelevantes
para o remédio).

---

## D. Disponibilidade (estoque) — o estoque é confiável?

### D.1 — Distribuição (monitor denso, 2.840 pontos)
```
sentinela 99999 (tem, qtd ?): 1.270 (45%)   |  qtd real: 1.148 (40%)
indisponível: 141 (5%)        |  NULL (não-VTEX): 281 (10%)
```

### D.2 — Sinal por fonte
`qtd` REAL vem de ~metade das VTEX (venancio 152, indiana 152, globo 138, precopopular 134,
catarinense 121); as outras (paguemenos, extrafarma, saojoao, drogasmil, rosario) reportam **só
99999** (booleano "tem"). Não-VTEX (panvel/nissei/araujo) = sem sinal de estoque.

---

## Frete — gap estrutural (não auditável por dado)
Nem `catalogo_preco_hist` nem `medicamento_monitor_hist` persistem frete/prazo (só preço/estoque).
Frete é calculado ao vivo no clique e descartado. Para alerta por **custo total**, será preciso
passar a gravar frete por (EAN, fonte, CEP-ref) — decisão de instrumentação, não defeito de dado.

---

## Ordem de conserto sugerida (por número)

| # | Conserto | Evidência | Esforço/impacto |
|---|---|---|---|
| 1 | **Filtrar o sentinela 99999 no harvest VTEX** | B.3/B.5 — domina o "acima do teto" e envenena min/máx; o caminho ao-vivo já filtra | **maior impacto, menor esforço** |
| 2 | **Escopar a vertical a farmácias** (separar/marcar os ~30 supermercados) | A.1/A.2/B.5 poluídos por mercearia | decisão de escopo, não de dado |
| 3 | **Força clínica do semaglutida/liraglutida injetável** | A.3/A.4 — bug clínico real mas estreito (31 EANs) e **sem campo oficial** → parse do nome / tabela curada por registro | médio, bounded |
| 4 | **PMC do pack certo + descartar placeholders de centavo** | B.4 — teto casado à apresentação errada; preços `0,01` | menor magnitude |

Estoque (D) e frescor (C) estão **aceitáveis** para um alerta "tem/não tem" e preço recente; só o
`qtd` real é parcial (metade das VTEX).

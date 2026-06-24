# Captura visual de sinal de programa de laboratório (postura 2) — PROPOSTA DE PRODUÇÃO

> **Desenho apenas.** Nada construído, sem migração. Aguarda OK antes de tabela/pipeline/endpoint.
> Base empírica: diagnóstico pareado Mounjaro (115 pares) — VLM vê o selo em ~91 páginas, HTML
> estruturado só em ~31, **SÓ_B=50**; valor só estruturado em panvel/araujo. (2026-06-23)
>
> **Saída QUALITATIVA:** "tem programa X (Lilly/NovoDia/…) nesta farmácia para este EAN". SEM número.
> O percentual vem DEPOIS, da camada de regras curadas — nunca lido do selo. Esta camada **não toca preço**.

---

## 1) Schema do sinal — `programa_sinal` (por EAN × fonte × programa) — PROPOSTO
```sql
CREATE TABLE programa_sinal (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ean                   VARCHAR(14)  NOT NULL,
  fonte                 VARCHAR(40)  NOT NULL,
  programa_detectado    VARCHAR(80)  NULL,        -- 'Lilly' | 'NovoDia' | 'Desconto de Laboratório' | …
  presente              TINYINT      NOT NULL DEFAULT 0,   -- bool: selo presente na última captura boa
  percentual_indicativo DECIMAL(5,2) NULL,        -- SEMPRE NULL agora; porta p/ a camada de regras curadas
  -- proveniência
  fonte_sinal           ENUM('vlm','html_estruturado','html_texto') NOT NULL,
  modelo_vlm            VARCHAR(60)  NULL,         -- ex.: google/gemini-2.5-flash
  shot_hash             CHAR(16)     NULL,         -- fpVisual da captura que gerou o sinal (liga ao cache)
  -- validação
  estado_validacao      ENUM('DETECTADO','VALIDADO','NAO_CORROBORADO','EXPIRADO') NOT NULL DEFAULT 'DETECTADO',
  confirmacoes          INT          NOT NULL DEFAULT 1,   -- nº de capturas consecutivas que viram o selo
  -- frescor / expiração
  detectado_em          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  validado_em           DATETIME     NULL,
  ultima_confirmacao    DATETIME     NULL,         -- última captura BOA que re-confirmou o selo
  expira_em             DATETIME     NULL,         -- ultima_confirmacao + janela (ver §4)
  atualizado_em         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ean_fonte_prog (ean, fonte, programa_detectado),
  KEY idx_estado_exp (estado_validacao, expira_em),
  KEY idx_ean_fonte (ean, fonte)
);
```
- `percentual_indicativo` **NULL desde já** — porta aberta para a camada de regras curadas, **sem migração futura**.
- `shot_hash` = a impressão `fpVisual` do cache já construído → liga sinal ↔ screenshot que o gerou (auditável).
- `ultima_confirmacao` é o coração da expiração (§4); `confirmacoes` serve a promoção anti-alucinação (§3).

---

## 2) Cadência em 3 velocidades + pré-filtro (o coração da economia)

| velocidade | o quê | porquê esta cadência | custo VLM |
|---|---|---|---|
| **4/4h** | **PREÇO** (estruturado, já existe) | preço muda rápido; é o núcleo do alerta | **0** (não toca aqui) |
| **diário (incremental)** | **SELO** — render + fingerprint; VLM **só** onde o `fpVisual` mudou e o HTML não resolve | selo é estável → quase nenhuma página muda/dia | ~quase 0 |
| **semanal (full-scan)** | re-verifica **todas** (pré-filtradas); renova validade dos sinais ativos | rede de segurança p/ mudança **só-imagem** (que o HTML não vê) + frescor | ~$0,15–0,35/semana |

**Pré-filtro HTML (grátis, ANTES do VLM)** — corrobora sem chamar o VLM:
1. **`preco_cond` estruturado** (Panvel/Araújo) → programa confirmado por dado estruturado.
2. **Texto no HTML**: regex `lilly|novodia|programa|laborat[óo]rio|desconto.*laborat` no markup → corrobora.
→ O VLM **só corre no resíduo**: página que **mudou visualmente** **E** cujo HTML **não** resolve (o caso SÓ_B).

**Re-confirmação implícita diária (a chave da economia E do frescor):** no ciclo diário, render de todas;
para um sinal VALIDADO cujo `fpVisual` **continua igual**, isso é **re-confirmação grátis** (selo na mesma) →
atualiza `ultima_confirmacao` **sem chamar VLM**. O VLM só dispara quando o `fpVisual` muda.

**Economia quantificada** (grid Mounjaro = 115 páginas; VLM medido ≈ **$0,0025/página**):
- **Ingénuo** (VLM em tudo, 4×/dia): 115 × 4 × 30 × $0,0025 ≈ **$34,5/mês**.
- **Proposto**: full-scan semanal pré-filtrado (~50% precisa de VLM ≈ 58 págs) $0,15/sem × 4,3 ≈ $0,62/mês
  **+** incremental diário (~3 págs mudam/dia) 3 × $0,0025 × 30 ≈ $0,23/mês ≈ **~$0,85/mês**.
- → **~40× mais barato** ($0,85 vs $34,5). Para a classe GLP-1 inteira (~440 pares): ~$3–4/mês vs ~$130/mês.
- **Custo BINDING real = tempo de render** (não o $): ~11,4 s/página → ~22 min/dia p/ 115 (ou ~80 min p/ 440).
  Mitigação: o incremental pode **render só as páginas que o capture estruturado 4/4h marcou como mudadas**
  (piggyback no que já corre), reservando o **render-de-tudo** para o full-scan semanal off-peak.

---

## 3) Validação anti-alucinação (obrigatória antes de virar sinal)
**Estados:** `DETECTADO` (visto, quarentena, NÃO exibido) → `VALIDADO` (corroborado, vira sinal) · ou
`NAO_CORROBORADO` (visto 1× só-VLM, fica em quarentena à espera).

Regra de promoção `DETECTADO → VALIDADO`, por ordem de força:
1. **Há `preco_cond` estruturado** (Panvel/Araújo): estruturado confirma o VLM → **VALIDADO imediato**.
2. **Há texto no HTML** (`lilly|programa|laboratório…`): corroboração barata → **VALIDADO imediato**.
3. **Só-VLM (sem estruturado nem texto)** — o caso de risco: exigir **≥2 capturas consecutivas** com o
   **mesmo `programa_detectado`** (`confirmacoes≥2`) antes de promover. **Recomendado e justificado:** um
   selo real é estável e reaparece no ciclo seguinte; uma alucinação não repete de forma fiável o mesmo
   nome de programa. Até lá fica `NAO_CORROBORADO` (não exibido). Custo: 1 ciclo de atraso só nos só-VLM.

→ Recomendo **(1)/(2) instantâneos + (3) com gate de 2 capturas**. Barato (a maioria cai em 1/2) e seguro.

---

## 4) Expiração e frescor (salvaguarda contra desinformação)
- **`expira_em = ultima_confirmacao + 14 dias`** (DECISÃO do dono, 2026-06-23). Justificação: re-confirmação
  **implícita diária** (§2 — `fpVisual` igual renova de graça) + **dois ciclos full-scan semanais de folga**.
  A **assimetria de erro favorece NÃO deixar de sinalizar** um programa existente: o falso-positivo (programa
  extinto sinalizado por até 14 d) é raro e de baixo custo (o usuário não perde dinheiro, só um desconto que
  tentaria), enquanto expirar cedo faz o app **deixar de avisar um desconto real** — contra o valor da camada.
  O **congelamento-na-cegueira** (abaixo) já cobre falha de infra, então os 14 dias só precisam cobrir
  "selo realmente sumiu".
- **Sinal exibido cuja captura falha nos ciclos seguintes:** **mantém-se com a data** ("programa Lilly —
  sinal de <ultima_confirmacao>") até `expira_em`; depois `EXPIRADO` e **deixa de exibir**. Degrada com
  data visível, não some de repente.
- **Selo visto AUSENTE numa captura BOA** (renderizou, VLM não viu o programa) ≠ captura falhada: 2
  ausências consecutivas em capturas boas → `presente=0` e retira o sinal (some mais rápido que a expiração).
- **Falha silenciosa — detetar, nunca engolir:** cada varredura grava **saúde** (% render OK, % VLM OK,
  render OK **por fonte**). Gatilhos de alarme: render global < limiar (chromium partido), erro VLM alto
  (OpenRouter fora), ou **uma fonte cair a 0% de render** (layout mudou/bloqueou). Nessa janela: **NÃO
  expirar** sinais por "não re-confirmado" (distinguir *programa sumiu* de *nós paramos de ver*) — congela
  o relógio de expiração dessa fonte e emite "captura parada para <fonte>". A expiração só avança com
  **capturas BOAS** que não acham o selo.

---

## 5) Ligação à sinalização (postura 2) — aditivo, SEM tocar preço
- O `/catalogo` (e `/info`) ganham, na entrada de cada farmácia, um campo **opcional**
  `programa: { nome, desde: ultima_confirmacao, estado:'VALIDADO' }` — só quando há sinal **VALIDADO e
  não-expirado**. UI: chip qualitativo **"💊 tem programa Lilly — cadastre-se (sinal de <data>)"**,
  **separado** dos números de preço, **nunca** somado a `preco`/`total`/`menor`.
- **Puramente aditivo:** novo campo na resposta + nova leitura `LEFT JOIN programa_sinal`; **zero** alteração
  na lógica de preço, no `preco_cond` estruturado existente (Panvel/Araújo mantêm-se), no motor de alertas,
  no Cluster 2 ou na captura 4/4h. O sinal é a camada QUALITATIVA de existência para as VTEX onde não há valor.

---

## 6) Custo / modelo / andaime
- **Modelo VLM:** `google/gemini-2.5-flash` (multimodal) via OpenRouter — **medido ≈ $0,0025/página** (o LLM
  do pré-filtro/Método A é texto, semelhante mas só corre no resíduo). Custo mensal do desenho: **~$0,85/mês**
  (Mounjaro 115) / **~$3–4/mês** (classe GLP-1). Ingénuo seria ~$35 / ~$130.
- **Chromium / `/home/dev/diag`:** hoje é o temporário autorizado, isolado. **Decisão proposta:** promover a
  **infra de produção versionada** — o(s) script(s) de captura entram no repo (ex.: `backend/tools/captura_visual/`);
  o chromium fica **instalado no host** (documentado no Runbook: `npx playwright install --with-deps chromium`,
  como `dev`); corre por **cron do `dev`** (full-scan semanal off-peak + incremental diário). **Ónus consciente:**
  o chromium passa a precisar de manutenção (updates de segurança no host partilhado) e o **tempo de render** é o
  recurso a vigiar (CPU + banda do proxy BR p/ as geo). Alternativa mais limpa mas mais pesada: containerizar a
  captura (isola o chromium do host) — **recomendo adiar** a containerização até o volume justificar; começar com
  o script versionado + chromium no host + cron, que reusa tudo o que já existe.

---

## ⏸️ PARE — aguarda OK
Nada construído. Com o teu OK, a ordem de implementação seria: (a) migração `programa_sinal`;
(b) script de captura-de-selo reusando o cache (pré-filtro → VLM no resíduo → validação → estados);
(c) crons (semanal full + diário incremental) + saúde/alarme; (d) campo aditivo no `/catalogo` + chip na UI.
Cada um é uma tarefa seguinte, separada.

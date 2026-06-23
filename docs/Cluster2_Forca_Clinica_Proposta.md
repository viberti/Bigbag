# Cluster 2 — Força clínica + qtd curadas + equivalência GLP-1 (PROPOSTA, Fases 0–3)

> **Aditivo. Nada aplicado ainda** — proposta para aprovação antes da Fase 4. Não edita
> `medicamento`, não toca preço/guard/monitor/coleta. Fonte dos valores: lupa STEP 6
> (cross-check entre fontes) + `apresentacao` oficial da CMED. (2026-06-23)

---

## FASE 0 — Risco de sobrescrita (justifica a tabela separada)

`carregar_cmed.mjs` popula `medicamento` por **`INSERT … ON DUPLICATE KEY UPDATE`**, e o `UPDATE`
inclui:
```
dose_valor=VALUES(dose_valor), dose_unidade=VALUES(dose_unidade), forma=VALUES(forma),
qtd_embalagem=VALUES(qtd_embalagem), generico=VALUES(generico), …
```
→ **Qualquer correção in-place em `medicamento` (dose/forma/qtd) seria SOBRESCRITA no próximo import
semanal** (cron Qua 01:30). Confirmado: a tabela de override separada é necessária.

---

## FASE 1 — DDL proposto (NÃO criado)

```sql
-- 081 — override curado de força clínica + quantidade (Cluster 2). ADITIVO: a equivalência lê
-- COALESCE(curado, medicamento); o import da CMED nunca toca aqui (sobrevive ao reload semanal).
CREATE TABLE IF NOT EXISTS medicamento_curado (
  ean                 varchar(14)  NOT NULL,          -- apresentação (átomo com preço)
  registro            varchar(20)  DEFAULT NULL,      -- âncora oficial ANVISA (rastreabilidade)
  forca_valor         decimal(10,4) DEFAULT NULL,     -- força CLÍNICA (não a concentração)
  forca_unidade       varchar(16)  DEFAULT NULL,      -- 'mg'
  forca_periodicidade varchar(16)  DEFAULT NULL,      -- 'semana' (GLP-1 semanal); NULL se n/a
  papel               varchar(20)  DEFAULT NULL,      -- 'manutencao' | 'inicio'
  qtd_embalagem_corr  int          DEFAULT NULL,      -- override de qtd quando a oficial é 0/errada
  fonte_curadoria     varchar(120) DEFAULT NULL,      -- proveniência
  curado_em           datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  curado_por          varchar(80)  DEFAULT NULL,
  nota                varchar(255) DEFAULT NULL,
  PRIMARY KEY (ean),
  KEY idx_curado_equiv (forca_valor, forca_unidade, papel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## FASE 2 — Valores curados propostos (NÃO inseridos)

Força = STEP 6 da lupa (cross-check entre fontes, 100% consistente) **corroborada pelo
`apresentacao` oficial**. Qtd do Mounjaro = texto oficial **"4 SER PREENC"** (4 seringas preenchidas).
Periodicidade = `semana` (GLP-1 semanal).

| EAN | Produto | força_valor | un | papel | qtd_corr | Fonte | Sanidade (conc.=2×força, 0,5 ml) |
|---|---|--:|---|---|--:|---|:--:|
| 7897705202586 | Ozempic | **1** | mg | manutencao | — | lupa + apres "DOSES 1 MG" | n/a (Ozempic) |
| 7897705202548 | Ozempic starter | **0,25** ⚠️ | mg | **inicio** | — | apres "DOSES 0,25MG E 0,5 MG" | n/a |
| 7896382709111 | Mounjaro | **2,5** | mg | manutencao | **4** | lupa + apres "5 MG/ML … 4 SER PREENC" | 5×0,5=2,5 ✓ |
| 7896382709135 | Mounjaro | **5** | mg | manutencao | **4** | idem | 10×0,5=5 ✓ |
| 7896382709159 | Mounjaro | **7,5** | mg | manutencao | **4** | idem | 15×0,5=7,5 ✓ |
| 7896382709173 | Mounjaro | **10** | mg | manutencao | **4** | idem | 20×0,5=10 ✓ |
| 7896382709197 | Mounjaro | **12,5** | mg | manutencao | **4** | idem | 25×0,5=12,5 ✓ |
| 7896382709210 | Mounjaro | **15** | mg | manutencao | **4** | idem | 30×0,5=15 ✓ |

**Todas as 6 sanidades do Mounjaro passam.** ⚠️ **1 valor incerto:** o starter `7897705202548` é a
caneta dupla **0,25/0,5 mg** — `decimal` guarda 1 valor. Propus **0,25** (dose inicial) + `papel='inicio'`
(que já o isola); a `nota` registaria "caneta de titulação 0,25/0,5 mg". **Confirma o 0,25 ou preferes 0,5?**

**Nota de cobertura (não acionada):** Wegovy/Ozivy/Poviztra/Extensior (semaglutida injetável, **com
oferta**) **não** foram cross-checked pela lupa (STEP 6 só mapeou Ozempic+Mounjaro) → ficam **sem
curadoria** nesta proposta. As suas forças estão no `apresentacao` ("DOSES X MG") e seriam o passo
seguinte natural para fechar a classe. Quero o teu OK para incluí-los já (derivados do apresentacao,
mesma metodologia) ou deixar para depois.

---

## FASE 3 — Mudança da equivalência (DIFF) + ANTES/DEPOIS (provado por simulação)

**DIFF de `equivalentesComOferta`** (conceptual):
```diff
- WHERE m.substancia <=> ? AND m.dose_valor = ? AND m.dose_unidade = ? AND m.forma = ?
- ORDER BY (MIN(cp.preco) / NULLIF(m.qtd_embalagem,0)) ASC
+ LEFT JOIN medicamento_curado mc ON mc.ean = m.ean
+ WHERE m.substancia <=> ? AND m.forma = ?
+   AND COALESCE(mc.forca_valor, m.dose_valor)   = ?   -- FORÇA_EFETIVA (curada p/ injetável, estrutural p/ oral)
+   AND COALESCE(mc.forca_unidade, m.dose_unidade) = ?
+   AND COALESCE(mc.papel, 'manutencao')         = ?   -- REGRA DURA: 'inicio' só com 'inicio'
+ ORDER BY (MIN(cp.preco) / NULLIF(COALESCE(mc.qtd_embalagem_corr, m.qtd_embalagem),0)) ASC
```
(A força/forma/papel da referência resolvem-se 1× pelo mesmo COALESCE antes da query. Molécula
mantém match string-exato — a lupa confirmou grafia limpa; DCB fica como nota de futuro.)

**ANTES/DEPOIS (simulação read-only com os valores propostos):**

**(a) Ozempic 1mg `7897705202586`** — para de colapsar:
- ANTES (dose_valor=1,34): **11 no balde** → OZIVY×3, OZEMPIC/0,25mg, OZEMPIC/1mg, WEGOVY×2, EXTENSIOR×2, POVIZTRA×2.
- DEPOIS (força_ef=1mg+manutencao): **1 no balde** → só OZEMPIC/1mg. ✅ não agrupa com 0,25/starter/biossimilares.
  *(Agrupa só consigo porque Wegovy/Ozivy/etc. ainda não estão curados — ver nota de cobertura.)*

**(b) Starter `7897705202548`** sai da manutenção:
- DEPOIS (força_ef=0,25mg+**inicio**): **1 no balde** → OZEMPIC/0,25mg/inicio, **isolado** (papel≠manutencao). ✅

**(c) Forças do Mounjaro em baldes separados:**
- 709111→2,5mg, 709135→5mg (cada um no seu balde, não colapsados). ✅

**(d) Preço-por-dose finito (resolve ÷0 do Mounjaro):**
- 709111: ANTES **NULL (÷0)** (qtd=0) → DEPOIS **R$415,69** (qtd_ef=4). ✅
- 709135: ANTES NULL → DEPOIS **R$499,73**. ✅

---

## ✅ APLICADO — Fase 4 + Fase 5 (2026-06-23)

**Fase 4** (migr. 081 + `curadoria_glp1.mjs`, transação idempotente, COMMIT): `medicamento_curado`
criada (com `forca_valor_max`), **23 linhas** inseridas (Ozempic 2 + Mounjaro 6 + Extensior 2 +
Ozivy 3 + Poviztra 5 + Wegovy 5; as 2 correções 0,25→inicio incluídas). `equivalentesComOferta`
agora usa FORÇA/QTD efetivas por COALESCE(curado, medicamento) e isola por `forca_valor_max <=>`.

**Fase 5 — baldes provados (query deployada, dados reais):**
- **(a) Classe semaglutida-injetável 1mg FECHADA** — balde de **6**: Ozempic + Ozivy(×2) + Poviztra +
  Extensior + Wegovy, todas 1mg/manutenção. (Antes: 11, colapsado com 0,25/2/starter.) ✅
- **(b1) Início FAIXA 0,25/0,5** (max=0,5): 3 → Ozempic, Extensior, Ozivy (canetas duais). ✅
- **(b2) Início 0,25-EXATA** (max=NULL): 2 → Wegovy ↔ Poviztra. ✅
  → **os dois baldes de início NÃO se misturam** (max 0,5 vs NULL) **nem com a manutenção**. ✅
- **(c)(d) Mounjaro 2,5mg**: balde de 1 (separado das outras forças) · **preço/dose = R$415,69**
  (÷0 do qtd=0 resolvido por qtd_ef=4). ✅
- **Wegovy 1,7mg**: balde de 2 (Wegovy ↔ Poviztra 1,7) — **sem Ozempic** (não tem 1,7). ✅
- **Rybelsus 3mg ORAL**: balde de 1, força estrutural (dose_valor), **inalterado**. ✅

**Nada mais mudou:** preços/guard/monitor intactos (tabela aditiva, só leitura na equivalência);
orais usam `dose_valor` como antes. `medicamento` não foi editada.

---

## ✅ ETAPA 2 — Catálogo hierárquico read-only (2026-06-23)

**2A — hoje:** `/buscar` e `/equivalentes` partem da identidade mas com `medicamento JOIN
catalogo_produto` (**INNER, offer-gated**) → apresentação sem oferta nunca aparece. `/info` é
identity-first mas por-EAN. Não havia vista marca→todas-as-apresentações (com SEM_OFERTA).

**2B+2C — `GET /api/medicamento/catalogo?marca=|registro=`** (público, read-only): parte de
`medicamento` (todas as apresentações da marca) com **LEFT JOIN** nas ofertas (só fontes FARMÁCIA,
`preco>0` → guard Cluster 1). Hierarquia **marca → apresentações → farmácias**:
- rótulo de força pela **CURADA** (`rotuloForca`; nunca "1,34 mg/ml" cru; início → "dose de início 0,25–0,5 mg/semana");
- **COM_OFERTA primeiro**, SEM_OFERTA num bloco rebaixado; apresentações **ordenadas por força clínica crescente** (não por preço);
- farmácias por apresentação **ordenadas por preço** (+ `preco_cond`/obs, `disponivel`/estoque do monitor, `frescor_h`);
- **`alternativas_mesma_forca`** anexado por apresentação (outras marcas mesmo balde, ordenadas por preço) + `nota_alternativas` ("não é genérico oficial; troca exige decisão médica; não substitui a marca pedida") — camada opcional que **não reorganiza** a tela.

**2D — provado:**
- **Ozempic** (4 apres, 2 c/ oferta): "dose de início 0,25–0,5 mg/semana" → alternativas Ozivy/Extensior (baldes início); "1 mg/semana" → alternativas Ozivy×2/Poviztra/Extensior/Wegovy (classe 1mg fechada); 2 SEM_OFERTA rebaixadas.
- **Mounjaro** (24 apres, 6 c/ oferta): 2,5→15 mg/semana c/ qtd_ef=4 (preço/dose finito), farmácias por preço, estoque=True; alternativas vazias (tirzepatida só Mounjaro); **18 SEM_OFERTA rebaixadas — os EANs CMED suspeitos 7906…/7916…/7926…/7936…/7946… aparecem NATURALMENTE como SEM_OFERTA, sem tratamento especial.** ✅

**Nota cosmética (não-bloqueante):** apresentações SEM_OFERTA não-curadas com `dose_unidade='MG/ML'`
mostram "força a curar" (não expõem a concentração crua, por design); curá-las é dispensável (sem
preço a comparar). Read-only confirmado: o endpoint não escreve nada.

---

## ⏸️ Histórico — gate das Fases 1–3 (já aprovado)
1. **DDL** da `medicamento_curado` — aprovado?
2. **Valores curados** — aprovados? E o **starter**: `forca_valor=0,25` ou `0,5`?
3. **Cobertura** — incluir já Wegovy/Ozivy/Poviztra/Extensior (forças do `apresentacao`), ou só Ozempic+Mounjaro agora?
4. **DIFF da query** — aprovado?

Só após o teu OK avanço para a **Fase 4** (criar tabela + inserir em transação + alterar a query) e
**Fase 5** (re-medição). Backup de hoje já existe (operação aditiva).

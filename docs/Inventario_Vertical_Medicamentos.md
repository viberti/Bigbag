# Inventário — Vertical de Medicamentos (BigBag Remédios)

> **Retrato preciso e honesto do estado atual**, lido do código real e da BD ao vivo em
> **2026-06-23**. Tarefa SOMENTE de inventário: o que existe, com evidência (DDL/queries/trechos
> reais). Onde não há, está marcado **NÃO ENCONTRADO**. Não propõe migração nem refactor.
> *(Snapshot pontual — verificar contra o código atual antes de agir sobre afirmações de `file:line`.)*

---

## Resumo (8 linhas)

O BigBag é uma PWA (React/Vite) + backend Node/Express + MySQL, hospedada no servidor partilhado
`85.25.46.6` sob o user Linux `dev`. A vertical de **remédios** (construída 2026-06-22/23) compara
preços de medicamentos no Brasil. A **identidade** vem da lista CMED/ANVISA (tabela `medicamento`,
chave = **EAN**), enriquecida com a ANVISA Dados Abertos. O **preço** vem de **23 farmácias online**
colhidas para `catalogo_produto`, casadas com a identidade **por EAN**. Há histórico de preço
append-on-change (`catalogo_preco_hist`, ~460k linhas desde 2026-06-16) e um monitor denso 4/4h de
uma lista global de marcas (`medicamento_monitor_hist`, começou em 2026-06-23). Frete é calculado
**ao vivo** (VTEX, por CEP), não persistido. **Não há** lista por-usuário, motor de gatilho, nem
notificação push.

---

## 1. Visão geral e execução

**Backend:** Node.js (ESM, `"type":"module"`), **Express**. Deps reais (`backend/package.json`):
`dotenv, express, jose, multer, mysql2, sharp, undici, unpdf, xlsx`. Sem devDependencies (testes via
`node --test`). Script: `start: node src/server.js`.

**Árvore (2 níveis, sem node_modules/dist):**
```
backend/{data, infer, migrations, scripts, src, test}
  src/{auth.js, config.js, consulta.js, db.js, openrouter.js, rede.js, server.js, tools.js, ...}
  src/ingest/{precoVivo.js, precoPanvel.js, precoNissei.js, precoAraujo.js, monitorarPrecos.js, extract.js, ...}
  src/routes/{medicamento.js, lista.js, produto.js, admin.js, faturas.js, voz.js, consulta.js, perfil.js, explorar.js}
  src/normaliza/{medicamento.js, ean.js, matcher.js, categoria.js, fichaEan.js, ...}
  scripts/{harvest_vtex, harvest_panvel, harvest_nissei, harvest_araujo, harvest_raiadrogasil, harvest_jsonld,
           carregar_cmed, carregar_anvisa, monitorar_precos, refresh_farmacias, fontes_farmacia.json}
frontend/{public, src}
deploy/{apache, systemd}
docs/, design/
```

**Como sobe:** `node src/server.js` (porta `4200`), via systemd `bigbag-backend.service` (User=dev),
no host partilhado `85.25.46.6`.

**Como o scraper é disparado:** **cron** do user `dev` (crontab real):
```
0 1 * * 0   refresh_farmacias.mjs          # semanal, Dom 01:00 (colhe TODAS as farmácias)
0 */4 * * * monitorar_precos.mjs           # de 4 em 4 horas (monitor denso da lista)
30 1 * * 3  carregar_cmed.mjs              # semanal, Qua 01:30 (lista CMED)
30 3 * * *  scrape_catalogo.mjs continente  # noturno (catálogo PT)
10 4 * * *  backup_db.sh                    # backup diário
```
*(ANVISA Dados Abertos = manual: o servidor não alcança a ANVISA.)*

---

## 2. Scraper / coleta

**Adaptador por farmácia OU genérico? Híbrido.** 17 farmácias VTEX usam um **scraper genérico**
(`harvest_vtex.mjs`); as não-VTEX têm **adaptador próprio** (`harvest_panvel/nissei/araujo/raiadrogasil/jsonld`).
O manifesto `fontes_farmacia.json` (23 fontes) tem um campo `motor`, e `refresh_farmacias.mjs` faz o switch:
```js
if (motor === 'raiadrogasil') … else if (motor === 'panvel') … else if (motor === 'nissei')
else if (motor === 'araujo') … else if (motor === 'jsonld') … else /* vtex */
```

**Assinatura comum dos adaptadores por-EAN** (convenção, não interface formal):
```js
export async function precoPanvelEan(ean, { uf, timeout } = {})    // → {existe, preco, preco_cond, preco_cond_obs, nome, marca, sku, imagem, url}
export async function precoNisseiEan(ean, { timeout } = {})        // idem (+ gtin)
export async function precoAraujoEan(ean, { timeout } = {})        // idem (+ gtin)
export async function precoEstoqueVtex(host, ean, { timeout, proxy }) // → {existe, preco, disponivel, qtd}
```

**Adicionar farmácia nova:** acrescentar `{fonte, host, motor, ...}` ao `fontes_farmacia.json`; se `motor`
novo, adicionar um ramo no switch + escrever `harvest_<x>.mjs`/`ingest/preco<X>.js`. As 23 fontes:
17 vtex, 2 raiadrogasil, 1 jsonld, panvel, nissei, araujo.

**Campos coletados por farmácia em cada execução** (INSERT real de `harvest_vtex.mjs`):
`fonte, sku_fonte, ean, nome, marca, categoria_path, categoria, cat_n1..4, formato, unidade_base,
formato_valor, preco, moeda, preco_por_base, url, imagem_url, scraped_at`.
- **preço:** SIM (`preco`); Panvel/Araújo também `preco_cond` + `preco_cond_obs` (desconto condicional/PBM).
- **estoque:** **NÃO no harvest.** Só ao vivo via `precoEstoqueVtex` (`AvailableQuantity>0` / `IsAvailable`)
  → gravado em `medicamento_monitor_hist.disponivel`/`qtd_estoque`, **não** em `catalogo_produto`.
- **frete / prazo:** **NÃO no harvest** — só ao vivo (`precoVivoVtex`, ver §5).
- **dosagem / apresentação / EAN-estruturado / registro ANVISA / princípio ativo:** **NÃO vêm da farmácia**
  — vêm da **CMED** (tabela `medicamento`). Da farmácia vem `ean` cru + `nome` (string) + `imagem`.

**Frequência:** harvest completo semanal (Dom); monitor 4/4h; CMED semanal.
**Falha de uma farmácia:** **aborta após 6 erros/HTTP-defesa consecutivos** (`consecErro >= 6 → break`);
**GUARD 0-linhas** (colheita vazia não apaga); tudo é **UPSERT (nunca DELETE)**. Erro fatal →
`process.exit(1)` daquele script; as outras fontes correm em sequência.

---

## 3. Identidade do produto — como é ancorada hoje [crítico]

**Modelo no banco (DDL real de `medicamento`):**
```sql
CREATE TABLE `medicamento` (
  `ean` varchar(14) NOT NULL,                 -- PK
  `registro` varchar(20) DEFAULT NULL,        -- registro ANVISA (13 díg.)
  `substancia` varchar(300), `produto` varchar(300), `apresentacao` varchar(600),
  `laboratorio` varchar(255), `classe_terapeutica` varchar(255),
  `tipo` varchar(40), `generico` tinyint(1) DEFAULT 0, `tarja` varchar(80),
  `dosagem` varchar(80), `dose_valor` decimal(12,4), `dose_unidade` varchar(16),
  `forma` varchar(60), `qtd_embalagem` int,
  `pf` decimal(10,2), `pmc_18` decimal(10,2), `pmc_por_icms` json, `pf_por_icms` json,
  `categoria_anvisa` varchar(40), `principio_ativo` varchar(400),
  `cmed_versao` date, `raw` json, ...
  PRIMARY KEY (`ean`),
  KEY idx_med_equiv (`substancia`,`dose_valor`,`forma`), KEY idx_med_registro (`registro`),
  FULLTEXT ft_med (`produto`,`substancia`)
)
```

**CHAVE CANÔNICA que casa o MESMO produto entre farmácias = EAN.** A junção preço↔identidade é sempre
`catalogo_produto.ean = medicamento.ean` (`routes/medicamento.js`):
```
L69:  WHERE ean = ? AND moeda='BRL' AND preco>0 AND fonte IN (...)   -- ofertasDoEan
L141: JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco > 0    -- equivalentes
```
Prova real (1 EAN, 4 farmácias, nomes diferentes, mesmo EAN):
```
paguemenos sku=53706  ean=7897705202586 "Ozempic 1mg Semaglutida..."       R$1279.99
panvel     sku=116907 ean=7897705202586 "Ozempic 1mg Semaglutida 3ml..."   R$1298.54 (cond 998.97)
araujo     sku=5157   ean=7897705202586 "Ozempic 1mg Solução Injetável..." R$1314.38 (cond 999)
nissei     sku=53287  ean=7897705202586 "Ozempic 1mg Caneta+4 Agulha..."   R$1338.88
```

**EAN capturado/armazenado?** SIM. **Nível = apresentação** (cada embalagem/pack tem o seu EAN).
`medicamento.ean` é PK; `catalogo_produto.ean` é o que vem da farmácia.

**REGISTRO ANVISA?** SIM — `medicamento.registro` (13 díg.) + tabela dedicada `anvisa_registro`
(PK `registro9` = 9 primeiros díg. = produto). **Vínculo oficial:** lista **CMED/ANVISA**
(`carregar_cmed.mjs`, semanal) + **ANVISA Dados Abertos** (`carregar_anvisa.mjs`, manual → `categoria_anvisa`,
`principio_ativo`). Tetos **PF/PMC** da CMED (`pf`, `pmc_18`, `pmc_por_icms`). **Bulário/DCB: NÃO ENCONTRADO**
como dado estruturado (bula = link-out + `medicamento_explicacao` gerado por LLM).

**Princípio ativo / molécula:** **campo estruturado** — `substancia` (CMED) e `principio_ativo` (ANVISA);
string, sem id de molécula normalizado.

**Dosagem e forma:** **campos separados e estruturados** — `dose_valor` (decimal), `dose_unidade`, `forma`,
`qtd_embalagem` (índice `idx_med_equiv`). **⚠️ Ressalva crítica:** para injetáveis o `dose_valor` é a
**concentração** da CMED, não a força clínica do dispositivo.

**TESTE CONCRETO (Ozempic, registros separados por dose?):**
```
ean=7897705202548 registro=1176600360042 OZEMPIC dose_valor=1.34 MG/ML forma=solução qtd_embalagem=1
ean=7897705202586 registro=1176600360050 OZEMPIC dose_valor=1.34 MG/ML forma=solução qtd_embalagem=3
ean=7897705203651 registro=1176600360077 OZEMPIC dose_valor=1.34 MG/ML forma=solução qtd_embalagem=3
ean=7897705203668 registro=1176600360069 OZEMPIC dose_valor=1.34 MG/ML forma=solução qtd_embalagem=1
```
**São REGISTROS SEPARADOS** (EAN + registro próprios). **MAS** a força clínica (0,25/0,5mg, 1mg, 2mg por
semana) **NÃO está estruturada**: todos têm `dose_valor=1.34` (concentração MG/ML); só `qtd_embalagem`
(1 vs 3) os distingue, e "1mg" aparece **apenas embutido no `catalogo_produto.nome`**. Para comprimidos
orais, `dose_valor` É a força por unidade (correto).

---

## 4. Persistência do histórico de preço

**Banco:** MySQL (`app_bigbag`). **DDL real:**
```sql
CREATE TABLE `catalogo_preco_hist` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `fonte` varchar(16) NOT NULL, `sku_fonte` varchar(24) NOT NULL, `ean` varchar(14) DEFAULT NULL,
  `preco` decimal(10,2) NOT NULL, `moeda` varchar(3) DEFAULT 'BRL', `preco_por_base` decimal(14,4),
  `visto_em` datetime NOT NULL,
  PRIMARY KEY (`id`), KEY idx_fonte_sku(`fonte`,`sku_fonte`), KEY idx_ean(`ean`), KEY idx_visto(`visto_em`)
)  -- SEM FOREIGN KEY
```
**Granularidade:** snapshot por `(fonte × sku_fonte/ean × visto_em)`. **Campos:** preço, moeda,
preco_por_base, timestamp. **NÃO guarda estoque, frete nem prazo.**

**Append sempre ou só on-change?** **Só quando o preço muda** (ou SKU novo) — `harvest_vtex.mjs` lê
`precoAtual` e só insere se `Number(ant) !== Number(novo)`.

**FK para o produto/SKU? NÃO ENCONTRADO.** Sem FOREIGN KEY (só índices `idx_ean`, `idx_fonte_sku`); `ean`
é `varchar` indexado, não FK. A ligação a princípio ativo+dosagem é **indireta** (join lógico `ean` →
`medicamento`). FKs só existem em 3 migrações antigas da camada de mercearia (`001_init`, `004_sku_alias`,
`011_revisao`), não nas tabelas de remédio.

**Tabela densa paralela** (snapshot 4/4h, com estoque + condicional):
```sql
CREATE TABLE `medicamento_monitor_hist` (
  `id` bigint AUTO_INCREMENT, `ean` varchar(14) NOT NULL, `fonte` varchar(40) NOT NULL,
  `preco` decimal(10,2), `preco_cond` decimal(10,2), `disponivel` tinyint, `qtd_estoque` int,
  `capturado_em` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(`id`), KEY idx_ean_ts(`ean`,`capturado_em`), KEY idx_fonte_ts(`fonte`,`capturado_em`)
)  -- SEM FK
```

**Registro real + série (Ozempic 7897705202586):**
```
catalogo_preco_hist (on-change):
  araujo 2026-06-23 08:58 R$1314.38   ← (subiu de 999 quando se corrigiu PBM→normal)
  araujo 2026-06-23 08:14 R$999
  nissei 2026-06-23 07:40 R$1338.88
  panvel 2026-06-23 07:07 R$1298.54
  farmais 2026-06-22 12:33 R$1187.69
  farmaconde 2026-06-22 08:08 R$1288.09

medicamento_monitor_hist (denso 4/4h):
  araujo  R$1314.38 cond=999    disp=null
  panvel  R$1298.54 cond=998.97 disp=null
  pacheco R$1236.17 cond=null   disp=1 qtd=99999
```
**Amplitude real:** `catalogo_preco_hist` = **459.729 linhas BRL, 161.541 EANs, de 2026-06-16 a 2026-06-23**.
`medicamento_monitor_hist` = **2.840 linhas, 26 EANs, 20 fontes, só 2026-06-23** (o monitor começou nesse dia).

---

## 5. Frete

Resolvido **ao vivo, por farmácia × CEP, sob demanda** — não persistido. `precoVivoVtex(host, ean, cep)`
faz a simulação de checkout VTEX e devolve (campos **separados**):
```js
return { existe, sku, preco, frete, prazo, entrega, retira,
         total: (preco + s1.frete),               // total = preço+frete, CALCULADO na resposta
         frete_gratis_maiores, frete_gratis_sub };
```
- **Por CEP:** SIM (`orderForms/simulation`, CEP ref 22241-040).
- **Persistido? NÃO** — só o **preço** é gravado no clique (`UPDATE catalogo_produto` + `INSERT
  catalogo_preco_hist`, `routes/medicamento.js:345-346`); frete/prazo/total **nunca** vão à BD.
- **Campo "total = preço+frete"?** Existe **só na resposta JSON** (`total`), calculado on-the-fly.
- Limiares de **frete grátis** publicados em `scripts/fretes_gratis.json` (8/18 farmácias).

---

## 6. Usuário / lista / notificação / programa

**Usuário/auth:** SIM. `auth.js` valida **Bearer JWT do Zitadel** (OIDC, JWKS+issuer via `jose`) +
**allowlist por email**; fallback HTTP Basic (`ENABLE_TEST_AUTH`). Tabela:
```sql
CREATE TABLE `usuario` (`email` varchar(160) PK, `pais` char(2) DEFAULT 'PT', `locale` varchar(5) DEFAULT 'pt-BR', ...)
```

**Lista de remédios monitorados por usuário? NÃO ENCONTRADO.** A lista é **global e por MARCA**:
```sql
CREATE TABLE `medicamento_monitorado` (`produto` varchar(190) PK, `ativo` tinyint DEFAULT 1, `criado_em` ...)
```
Existe lista **por usuário só para MERCEARIA** (`lista_pessoal(id, utilizador, nome, ...)` + `lista_item(...,
nome, ean, quantidade, categoria, estado, adicionado_por, fatura_id, unidade, qtd_medida)`) — sem ligação a remédios.

**Push / FCM? NÃO ENCONTRADO** (grep `fcm|firebase|web-?push|onesignal|apns|sendNotification` em `backend/` = 0).

**Dado de PBM / programa de fabricante / desconto? PARCIAL** — `catalogo_produto.preco_cond` (decimal) +
`preco_cond_obs` (varchar 160, ex.: "Desconto do laboratório (PBM) · 1ª Compra"), raspado de Panvel/Araújo.
**Sem tabela curada dedicada.**
**Proveniência em tabelas curadas? PARCIAL** — `catalogo_produto.url` (source_url) + `scraped_at`;
`medicamento.cmed_versao` + `raw` (json bruto); `anvisa_registro.atualizado_em`. Sem campo de curadoria manual.

---

## 7. API

API Express (`server.js`). Endpoints da vertical (`routes/medicamento.js`), **todos GET e PÚBLICOS**
(mount `app.use('/api/medicamento', medicamentoRouter)` linha 146, **sem** `requireAuth`; 0 ocorrências
no ficheiro):
```
GET /api/medicamento/info?ean=             → identidade + ofertas + melhor + melhor_cond + equivalentes
GET /api/medicamento/equivalentes?ean=     → mesma substância+dose+forma com oferta
GET /api/medicamento/buscar?q=             → FULLTEXT por nome/substância (dedup por registro9)
GET /api/medicamento/precos-ao-vivo?ean=&cep= → preço+frete+estoque ao vivo (VTEX)
GET /api/medicamento/explicacao?ean=       → "para que serve" (LLM)
GET /api/medicamento/monitor?ean=&dias=    → série do histórico denso (preço, preco_cond, estoque)
```
**Cliente:** `frontend/src/api.js` (`infoMedicamento`, `buscarMedicamento`, `precosAoVivo`, …),
consumido pela superfície pública **`/remedios`** (`AppV2.jsx` → `RemediosApp`).

---

## 8. Consulta de equivalência (verificação de capacidade)

**"Menor preço total entre produtos da mesma molécula + via + dosagem"? PARCIAL.** A query **existe**
(`equivalentesComOferta`):
```sql
SELECT m.ean, MIN(cp.preco) ...
  FROM medicamento m JOIN catalogo_produto cp ON cp.ean = m.ean AND cp.preco>0
 WHERE m.substancia <=> ? AND m.dose_valor = ? AND m.dose_unidade = ? AND m.forma = ?
 GROUP BY m.ean ORDER BY (MIN(cp.preco)/NULLIF(m.qtd_embalagem,0)) ASC
```
Agrupa por **substância + dose_valor + dose_unidade + forma**, com preço por dose. **O que impede o caso ideal:**
1. **"Via" (oral/subcutânea) NÃO é campo** — só `forma` (forma farmacêutica). Aproxima, não é a via.
2. **Molécula é string exata** (`substancia <=>`): "SEMAGLUTIDA" casa; "SEMAGLUTIDA SÓDICA"/grafia diferente
   **não** casaria; sem id de molécula normalizado (DCB).
3. **Dosagem de injetáveis = concentração**, não força clínica → agrupar "Ozempic 1mg" com "genérico
   semaglutida 1mg" pela `dose_valor` agrupa pela **concentração 1,34 MG/ML** (igual p/ caneta 1mg e 2mg).
   Para **comprimidos** funciona corretamente.

Resumo: **funciona bem para sólidos orais**, é **coarse/ambíguo para injetáveis**, match de molécula é
**exato-string**.

---

## 9. Lacunas vs. alvo

Alvo = identidade ancorada em ANVISA(registro)+EAN; agrupamento por molécula × via × dosagem; baseline
declarado pelo usuário; motor de gatilho (limiar relativo + piso absoluto + trava de estoque + cooldown);
lista monitorada por usuário; notificação; camada curada de programa de fabricante.

| Item-alvo | Estado | Evidência |
|---|---|---|
| Identidade ancorada em ANVISA(registro)+EAN | **EXISTE** | `medicamento.ean` (PK) + `registro` + tabela `anvisa_registro`; join por EAN |
| Agrupamento por molécula × via × dosagem | **PARCIAL** | `equivalentesComOferta` usa substância+`dose_valor`+forma; **"via" não é campo**, molécula string-exata, dose de injetável = concentração |
| Baseline declarado pelo usuário | **NÃO ENCONTRADO** | nenhum campo de baseline; `medicamento_monitorado` é global, sem preço de referência |
| Motor de gatilho (limiar rel.+piso abs.+trava estoque+cooldown) | **NÃO ENCONTRADO** | `monitorarPrecos.js` só faz `INSERT` de snapshots; nenhuma lógica de threshold/alerta/cooldown |
| Lista monitorada **por usuário** | **NÃO ENCONTRADO** | `medicamento_monitorado` PK=`produto` (marca), **sem coluna de usuário**; a lista por-user (`lista_pessoal`) é de mercearia |
| Notificação | **NÃO ENCONTRADO** | grep push/fcm/firebase/apns/webpush em `backend/` = 0 |
| Camada curada de programa de fabricante | **PARCIAL** | `catalogo_produto.preco_cond`+`preco_cond_obs` (raspado de Panvel/Araújo); sem tabela curada dedicada nem campo de curadoria manual |

**Incertezas marcadas:** (a) não foi inspecionado se há um middleware global de auth *antes* dos mounts em
`server.js` — confirmou-se apenas que `routes/medicamento.js` não tem `requireAuth` e está documentado como
público; (b) "via de administração" baseia-se na ausência do campo no DDL de `medicamento` (só há `forma`),
não numa busca exaustiva por sinónimos.

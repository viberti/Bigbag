# Trilho A — Monitor de preço de canetas GLP-1 por usuário (MVP) — RECONHECIMENTO + PROPOSTA

> **Read-only nesta etapa.** Nada criado/escrito. Proposta de schema para aprovação antes de
> qualquer migração. Foco: canetas emagrecedoras (semaglutida/tirzepatida/liraglutida injetáveis +
> Rybelsus). Núcleo = catálogo ao vivo (existe) + MONITORAR uma APRESENTAÇÃO (EAN). (2026-06-23)

---

## PARTE 1 — RECONHECIMENTO

### 1A — Autenticação (Zitadel JWT)
`requireAuth` (`backend/src/auth.js`): Bearer JWT → `jwtVerify` (JWKS do issuer + exp) → exige
**email na allowlist** → injeta:
```js
req.user = { id: b.email || b.sub, email: b.email, nome, sub: b.sub, via: 'oidc', ...locale }
```
- **Âncora = `req.user.id`, que É o `email`** (lowercased) para login OIDC. `sub` (subject Zitadel)
  fica disponível mas o app chaveia tudo por **email**.
- A tabela **`usuario` (PK `email`)** (migr. 062) é a âncora; `resolveLocale` **auto-cria a linha**
  (`INSERT IGNORE`) na 1.ª vez que vê o email. Fallback `test-auth` (Basic) dá `id` (pode não ter email).
- **Como ligar um registro ao JWT:** por `req.user.id` (= email) → FK lógica para `usuario.email`.
  É exatamente o que o padrão de lista pessoal já faz (ver 2A).

### 2A — Padrão de lista (o que espelhar)
Migr. 034 + `routes/lista.js`:
- **`lista_item`** = lista PARTILHADA da família (não por-usuário): `adicionado_por`/`marcado_por` são
  o **nome do MEMBRO** (`perfil_membro`, cor na UI), `senão req.user.id` — display, **não** a âncora de auth.
- **`lista_pessoal`** = lista INDIVIDUAL, **chaveada por `utilizador VARCHAR(64)`** com
  `UNIQUE(utilizador, nome)`. O CRUD usa **`req.user.id`** diretamente:
  ```js
  'SELECT id, nome FROM lista_pessoal WHERE utilizador = ?', [req.user.id]
  'INSERT IGNORE INTO lista_pessoal (utilizador, nome) VALUES (?, ?)', [req.user.id, nome]
  'DELETE FROM lista_pessoal WHERE id = ? AND utilizador = ?', [id, req.user.id]
  ```
→ **Este é o padrão a espelhar:** coluna `usuario_email` = `req.user.id`, CRUD sempre filtrado por
ele, atrás de `requireAuth`. (Uso `usuario_email` como nome — é o email; mais explícito que `utilizador`.)

### 3A — `medicamento_monitorado` (global) e o monitor denso
Migr. 078:
```sql
medicamento_monitorado ( produto VARCHAR(190) PK, ativo TINYINT, criado_em )   -- por MARCA (UPPER)
-- seed: INSERT IGNORE ('OZEMPIC'),('MOUNJARO')
medicamento_monitor_hist ( id, ean, fonte, preco, preco_cond, disponivel, qtd_estoque, capturado_em )
```
- `medicamento_monitorado` é **GLOBAL** (não por-usuário), PK=marca. Populado pela migr. (seed) +
  INSERT manual. Hoje OZEMPIC+MOUNJARO.
- **Relação com o monitor denso:** o job `monitorarMonitorados` (`ingest/monitorarPrecos.js`) **lê
  desta lista** para decidir o conjunto de EANs (ver 4A). O `medicamento_monitor_hist` é alimentado
  só por esse job (append-only, 4/4h via cron).

### 4A — Como os EANs entram no monitor denso (CRÍTICO p/ a ponte)
Query de seleção do job (`monitorarPrecos.js`):
```sql
SELECT DISTINCT m.ean, m.produto FROM medicamento m
 WHERE m.substancia IN (
   SELECT DISTINCT m2.substancia FROM medicamento m2
     JOIN medicamento_monitorado mm ON UPPER(m2.produto)=mm.produto AND mm.ativo=1
    WHERE m2.substancia IS NOT NULL)
   AND EXISTS (SELECT 1 FROM catalogo_produto cp WHERE cp.ean=m.ean AND cp.preco>0 AND cp.moeda='BRL')
```
→ O conjunto monitorado = **todos os EANs da mesma SUBSTÂNCIA das marcas semeadas, COM oferta.**
Hoje: semaglutida + tirzepatida → **as 26 EANs da lupa** (todas as canetas dessas 2 substâncias).
- **Adicionar EAN dinamicamente:** hoje **só por marca** — `INSERT INTO medicamento_monitorado
  (produto)` cobre a substância inteira dessa marca. **Não há adição granular por-EAN.**
- **Consequência para o Trilho A:** uma apresentação de **semaglutida ou tirzepatida** escolhida por
  um usuário **já está densamente monitorada** (cai na classe semeada). O buraco são **liraglutida**
  (Saxenda/Victoza) e qualquer caneta cuja substância não esteja semeada. → a ponte precisa garantir
  que o EAN do usuário entra no conjunto denso (ver Parte 2, "Ponte").

### 5A — Push/FCM: NÃO existe
Grep estrito (`fcm|firebase|webpush|vapid|apns|PushSubscription|pushManager`) em todo o repo (fora
`node_modules`): **0 ocorrências em código.** O único match é em `docs/Inventario_Vertical_Medicamentos.md`
(a registar a *ausência*). → push é **greenfield**, fica para tarefa futura (não nesta).

### 6A — Mediana de mercado por apresentação: derivável do que existe
Sim. Duas fontes, ambas já disponíveis:
1. **Catálogo (o que o `/catalogo` já usa):** `SELECT preco FROM catalogo_produto WHERE ean=? AND
   preco>0 AND moeda='BRL' AND fonte IN (FARMACIAS)` → ordenar → elemento do meio (mediana). MySQL não
   tem `MEDIAN()`, mas é trivial em JS (ou via window function). Guard do Cluster 1 já garante preços válidos.
2. **Monitor denso (mais fresco, 4/4h):** último snapshot por `(ean,fonte)` em `medicamento_monitor_hist`
   (mesmo padrão do `escolherImagem`/`/info`) → mediana dos preços disponíveis. **Recomendado** para
   EANs monitorados (mais recente que o harvest semanal).
→ A mediana pré-preenche o baseline na criação (aceita/corrige).

---

## PARTE 2 — PROPOSTA DE SCHEMA (NÃO criada)

Reutiliza: `usuario` (âncora email), o padrão `lista_pessoal` (CRUD por `req.user.id`), o monitor
denso `medicamento_monitor_hist` (gatilho lê daqui), o `/catalogo` (mediana). Duas tabelas novas + 1 ponte.

### Tabela 1 — `usuario_monitor` (usuário × EAN-apresentação)
```sql
CREATE TABLE usuario_monitor (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  utilizador         VARCHAR(160)  NOT NULL,        -- = req.user.id (email); convenção lista_pessoal
  ean                VARCHAR(14)   NOT NULL,        -- APRESENTAÇÃO monitorada (não marca)
  -- baseline
  baseline_declarado DECIMAL(10,2) NOT NULL,        -- baseline EFETIVO (o gatilho compara com este)
  baseline_sugerido  DECIMAL(10,2) NULL,            -- mediana de mercado no momento da criação (referência)
  baseline_origem    ENUM('declarado','aceito_sugerido') NOT NULL,  -- proveniência
  -- parâmetros do gatilho (defaults; o motor — tarefa futura — lê daqui). REGRA: limiar E piso (ambos).
  limiar_pct         DECIMAL(5,2)  NOT NULL DEFAULT 8.00,    -- queda relativa (%) vs baseline
  piso_abs           DECIMAL(10,2) NOT NULL DEFAULT 80.00,   -- piso absoluto (R$) — exigido junto com o limiar
  exige_estoque      TINYINT       NOT NULL DEFAULT 1,       -- trava de estoque (só dispara se disponível)
  cooldown_horas     INT           NOT NULL DEFAULT 72,      -- silêncio entre alertas do mesmo monitor
  ultimo_alerta_em   DATETIME      NULL,            -- p/ o cooldown (atualizado quando dispara)
  ativo              TINYINT       NOT NULL DEFAULT 1,        -- soft-delete (LGPD: exclusão REAL via FK CASCADE)
  criado_em          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_ean (utilizador, ean),         -- 1 monitor por (usuário, apresentação)
  KEY idx_ativo_ean (ativo, ean),                   -- p/ a PONTE do monitor denso (SELECT ean WHERE ativo=1)
  CONSTRAINT fk_monitor_usuario FOREIGN KEY (utilizador) REFERENCES usuario (email) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
- **Baseline:** `baseline_declarado` é o que o gatilho usa (mesmo quando o usuário aceita a sugestão,
  fica gravado o valor); `baseline_sugerido` guarda a mediana mostrada (referência/auditoria, sempre);
  `baseline_origem` distingue *aceito a sugestão* de *corrigi à mão*.
- **Gatilho (parâmetros, não o motor):** dispara só com **`limiar_pct` (≥8%) E `piso_abs` (≥R$80)
  SIMULTÂNEOS** + `exige_estoque` (trava) + `cooldown_horas`/`ultimo_alerta_em`. Ambos os campos têm
  DEFAULT NOT NULL (não há gatilho sem piso). O **motor** que aplica esta regra vem depois.
- **Âncora `utilizador VARCHAR(160)`:** mesmo nome nas 2 tabelas (convenção `lista_pessoal`), largura
  160 (≠ os 64 do `lista_pessoal`) para o email caber inteiro e a FK casar com `usuario.email`.

### Tabela 2 — `alerta_log` (histórico de alertas disparados)
```sql
CREATE TABLE alerta_log (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  monitor_id          BIGINT UNSIGNED NULL,         -- FK → usuario_monitor.id (qual config disparou)
  utilizador          VARCHAR(160)  NOT NULL,        -- mesmo nome/tipo da tabela 1
  ean                 VARCHAR(14)   NOT NULL,
  preco_gatilho       DECIMAL(10,2) NOT NULL,        -- preço que disparou
  baseline_no_momento DECIMAL(10,2) NOT NULL,        -- baseline efetivo quando disparou (NÃO só o atual)
  desconto_pct        DECIMAL(5,2)  NULL,            -- % abaixo do baseline (p/ medir qualidade depois)
  fonte               VARCHAR(40)   NOT NULL,         -- farmácia mais barata no disparo
  disponivel          TINYINT       NULL,            -- estoque no momento
  entregue            TINYINT       NOT NULL DEFAULT 0,  -- estado de entrega (push é tarefa futura; só o flag)
  disparado_em        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_ts (utilizador, disparado_em),
  KEY idx_cooldown (monitor_id, disparado_em),
  KEY idx_ean_ts (ean, disparado_em),
  CONSTRAINT fk_alerta_usuario FOREIGN KEY (utilizador) REFERENCES usuario (email) ON DELETE CASCADE,
  CONSTRAINT fk_alerta_monitor FOREIGN KEY (monitor_id) REFERENCES usuario_monitor (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
Serve o **cooldown** (rápido por `ultimo_alerta_em`; auditável por `alerta_log`) e, depois, **medir se
os alertas são bons** (`desconto_pct`, frequência). `baseline_no_momento` grava o baseline efetivo do
disparo (histórico fiel, não o baseline atual que pode ter mudado).

### LGPD — dado de saúde sensível (intenção registada; fluxo não implementado)
- **Soft-delete** de monitor = `ativo=0` (operação normal do usuário).
- **Exclusão GENUÍNA da conta (futuro):** as FKs `utilizador → usuario(email) ON DELETE CASCADE` em
  AMBAS as tabelas tornam a exclusão real trivial e completa — `DELETE FROM usuario WHERE email=?`
  apaga em cascata todos os monitores e alertas, **sem PII órfã**. `alerta_log.monitor_id → usuario_monitor
  ON DELETE SET NULL` preserva o histórico se um monitor isolado for hard-deleted (conta permanece).
- Toda a PII (utilizador) fica em 2 tabelas com FK rastreável → o apagamento real não vira caça a linhas
  espalhadas. **Não implementar o endpoint de exclusão-total agora** — só o schema o habilita.

### Ponte — o EAN do usuário entra no monitor denso (4A)
**Recomendado (preciso, sem poluir a lista global):** estender a query de seleção do job
`monitorarMonitorados` com uma UNIÃO:
```sql
   ... OR m.ean IN (SELECT ean FROM usuario_monitor WHERE ativo = 1)
```
→ o EAN exato escolhido por qualquer usuário passa a ser colhido 4/4h, **mesmo fora das substâncias
semeadas** (cobre liraglutida/futuras). `idx_ativo_ean` serve esta subquery. Sem mexer em
`medicamento_monitorado`. *(Esta alteração é da tarefa do MOTOR, não desta — o schema só a habilita.)*
- **Alternativa (mais grosseira):** `INSERT IGNORE INTO medicamento_monitorado` a MARCA do EAN →
  cobre a substância inteira. Mais simples, mas sobre-colhe e mistura conceito global com escolha de usuário.
- **Custo / NOTA DE CAPACIDADE (registar, não acionar):** a ponte por-EAN faz o conjunto de coleta
  densa **CRESCER com os usuários**. Hoje 26 EANs/4h; EANs de semaglutida/tirzepatida que os usuários
  escolham **já estão no conjunto** (custo zero no MVP). Só liraglutida/novas moléculas acrescentam
  EANs, e o custo de coleta 4/4h escala linearmente com (nº usuários × moléculas distintas
  monitoradas). Inócuo agora; **revisitar quando houver muitos usuários monitorando muitas moléculas**
  (ex.: deduplicar EANs entre usuários — já natural pela UNIÃO `DISTINCT` —, ou cadência adaptativa).

### Superfície de endpoints — PÚBLICO vs AUTENTICADO
**PÚBLICOS (já existem, sem PII):** `/catalogo`, `/info`, `/equivalentes`, `/buscar`, **`/monitor`**
(histórico denso por EAN — é dado de mercado, não de usuário), `/precos-ao-vivo`, `/explicacao`.

**AUTENTICADOS (NOVOS — `requireAuth`, filtrados por `req.user.id`; dado de saúde = sensível):**
*(apenas o desenho; nenhum escrito nesta etapa)*
| Método | Rota | Função |
|---|---|---|
| GET  | `/api/medicamento/monitor-usuario/sugestao?ean=` | mediana de mercado p/ pré-preencher o baseline |
| GET  | `/api/medicamento/meus-monitores` | lista os monitores do usuário (+ preço atual/estado) |
| POST | `/api/medicamento/monitor-usuario` | cria (ean + baseline_declarado + origem + params) |
| PATCH| `/api/medicamento/monitor-usuario/:id` | edita baseline/limiar/piso/estoque/ativo |
| DELETE | `/api/medicamento/monitor-usuario/:id` | remove (soft: `ativo=0`) |
| GET  | `/api/medicamento/meus-alertas` | histórico de alertas do usuário (de `alerta_log`) |

Regra: **lista/baseline/alertas SEMPRE atrás de auth** (saúde). O catálogo e o histórico denso por
EAN ficam públicos (sem PII).

### Fora de escopo desta tarefa (próximas, após schema aprovado)
- **Motor de gatilho** (lê monitor denso + `usuario_monitor`, aplica limiar/piso/estoque/cooldown,
  grava `alerta_log`).
- **Push/FCM** (canal de entrega; `alerta_log.entregue`).
- **PBM curado** (postura 2 mantida: publica `preco_cond` onde existe + sinaliza programa; não estima).

---

## ✅ MOTOR DE GATILHO IMPLEMENTADO (DRY-RUN) — 2026-06-23

- **Schema:** migr. 082 (usuario_monitor + alerta_log) **APLICADA**; migr. 083 (alerta_log `preco_cond`/
  `preco_cond_fonte`/`preco_cond_obs` — PBM informativo) **APLICADA**.
- **Ponte (`ingest/monitorarPrecos.js`):** a seleção do job denso ganhou `OR m.ean IN (SELECT ean FROM
  usuario_monitor WHERE ativo=1)` → o EAN do usuário entra na coleta 4/4h (cobre liraglutida/futuras).
  `idx_ativo_ean(ativo,ean)` serve a subquery.
- **Motor (`ingest/motorAlertas.js`, `avaliarAlertas`):** por monitor ativo, ordem barato-primeiro →
  último snapshot denso → filtra estoque (`sem_estoque`) → menor preço de TABELA → gatilho **limiar 8%
  E piso R$80 simultâneos** (`acima_do_limiar`) → `cooldown` → grava `alerta_log` **entregue=0** +
  atualiza `ultimo_alerta_em`. **NÃO envia nada.** `preco_cond` (PBM) capturado p/ informar, **nunca
  dispara**; bônus loga `dispararia_cond`. **Cadência:** roda LOGO APÓS a colheita densa (o cron
  `monitorar_precos.mjs` chama os dois; `0 */4`).
- **6 endpoints** (`routes/medicamento.js`, todos `requireAuth` + filtro `req.user.id`): `GET
  /monitor-usuario/sugestao`, `POST /monitor-usuario`, `GET /meus-monitores`, `PATCH`/`DELETE
  /monitor-usuario/:id` (soft), `GET /meus-alertas`. Isolamento por usuário.
- **Calibração:** `scripts/relatorio_alertas.mjs` (read-only) lista cada disparo do dry-run com
  contexto p/ julgar à mão + contagem; o motor loga por execução `avaliados/disparos/razões/
  dispararia_cond`. *(Opção futura: endpoint admin; o script basta p/ o single-user.)*
- **PROVA e2e (dry-run, monitores de teste, limpos por cascata):** run #1 → **1 disparo** (Ozivy 1mg
  R$597,62, −14,6% vs R$700, estoque=1, entregue=0) + `acima_do_limiar=1` + `sem_estoque=1` +
  `cooldown=1`; run #2 imediato → o disparo virou **cooldown** (disparos=0). `DELETE usuario` →
  cascata limpou monitores+alertas (0/0): **exclusão LGPD genuína provada**.

**Fora (próxima tarefa):** entrega/push (FCM) — lê `alerta_log` `entregue=0`, envia, marca `entregue=1`.
Calibrar 8%/R$80 com o relatório ANTES de ligar a entrega. PBM curado fora de escopo.

---

## ⏸️ Histórico — gate do schema (aprovado e aplicado)
Nada criado/escrito nesta fase de proposta. (Migração aplicada na fase seguinte.)

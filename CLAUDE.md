# CLAUDE.md — Regras de trabalho neste projeto

Projeto pessoal de laboratório, **utilizador único**. PWA (React/Vite `frontend/`) + backend Node/Express (`backend/`) + MySQL, no servidor de produção partilhado `85.25.46.6` (mesmo host de `pitacos.ai` e `1417`). App de histórico de preços de compras: lê faturas, guarda os dados, responde a consultas por nota de voz e gere uma lista de compras partilhada.

> **Este ficheiro é o PANORAMA + as regras.** O detalhe (arquitetura, schema, decisões, histórico) vive nos docs-fonte (ver §Documentação). Quando algo aqui crescer além de um parágrafo, move o detalhe para o doc e deixa só o ponteiro.

## Princípio geral
- **Autonomia máxima.** Decide sozinho tudo o que for **local e reversível** — estrutura de código, refactors, queries, migrações na BD do projeto, bibliotecas, commits. Não peças permissão. Ambíguo + reversível → escolhe a opção razoável, segue, regista a suposição.
- **Caso específico → regra GERAL** (dono, 2026-06-13): uma correção de classificação/normalização tem de criar lógica aplicável a um conjunto maior de produtos, nunca regras para artigos individuais. *Exceção deliberada:* produtos muito populares podem ter tratamento de **enriquecimento** especial (mais info, fontes próprias) — nunca de classificação.

## Paragens obrigatórias (a ÚNICA lista a confirmar antes de executar)
Mostra o que vais correr e confirma comigo ANTES de:
1. Comando que toque em **serviços partilhados** do host (MySQL global, Apache, systemd, UFW, certbot) de forma que possa afetar `pitacos.ai`/`1417`.
2. **SQL DDL/migração destrutiva** (DROP, TRUNCATE, ALTER que perca dados) — mostra o SQL. `GRANT` só em `app_bigbag.*`.
3. **Apagar/sobrescrever ficheiros** fora da árvore do projeto, ou ficheiros de dados/uploads existentes.
4. **Reescrever histórico partilhado** (force-push, rebase de ramos partilhados). *`git push` normal — incl. `main` — é livre.*
5. **Revogar o sudo temporário** (`/etc/sudoers.d/90-bigbag-nopasswd`).

Fora desta lista, age sem perguntar.

## Isolamento (regra dura)
- Nunca tocar em MySQL/Apache/serviços dos outros projetos sem avisar.
- BD `app_bigbag`, user MySQL `bigbag` (GRANT só em `app_bigbag.*`), porta local **`4200`**. Serviço `bigbag-backend.service`. Domínio `bigbag.hal9klabs.com`.
- Corre sob o **user Linux partilhado `dev`** em `/home/dev/bigbag` (reusa o `dev`, que já aloja o 1417). O `.env` é 600 do `dev`; o ssh entra como `pitacos` → correr scripts como `sudo -u dev node --env-file=.env …`.
- `.env` **nunca versionado** (no `.gitignore` desde o 1.º commit), `chmod 600`. Segredos só em variáveis de ambiente, nunca hardcoded nem em ficheiros que vão a commit.
- Setup reutilizável **com segredos** vive fora do repo, no PC: `C:\ProjetosAI\Setup_Ambiente_Novo_Projeto_PRIVADO.md` (nunca comitar).

## Testar antes de dar por feito (obrigatório)
Uma tarefa só está concluída depois de **verificada a funcionar** — não basta compilar.
- **Backend:** o endpoint responde (curl ao `/health` e à rota nova); a migração aplica sem erro. Funções de tool use testáveis **por texto** antes de haver voz.
- **Frontend:** `npm run build` passa e o fluxo principal funciona no browser. Câmara/microfone testam-se em **dispositivo real** (sobretudo iOS/Safari).
- **Testes:** lógica pura em `backend/test/*.test.mjs` (correm no PC, são **GATE do deploy**). Testes que tocam BD/LLM têm sufixo **`.bd.test.mjs`** e só correm no servidor.
- **GOLDEN SET da classificação** (`test/golden_grupos.test.mjs` + fixture): casos reais com ouro auditado, gate do deploy. Mudaste vocabulário em `categoria.js`? O teste mostra o DIFF. Se intencional: `backfill_grupos.mjs` no servidor → regenerar fixture (`scripts/gerar_golden_grupos.mjs`, ver cabeçalho) → **commitar fixture e código juntos**.
- Se algo não dá para testar automaticamente, di-lo e descreve como verificaste à mão. **Nunca marcar "feito" com teste a falhar ou por correr.**
- **Higiene de dados de teste:** os e2e correm contra a BD REAL (single-user, sem staging). Remover SÓ os ids que o próprio teste criou; nunca `limpar`/`DELETE` global; confirmar no fim que o estado real ficou intacto.

## Deploy / backup / rollback
- **Deploy:** `bash scripts/deploy.sh` (`-f` se o frontend mudou) depois de commit+push. Faz `node --check`, corre os testes puros (GATE), recusa se houver commits por enviar, etiqueta a versão (`git tag vX.Y.Z`), e no servidor: pull → build → restart → espera `/health`. Não repetir o ritual à mão.
- **Backup:** `mysqldump` diário às 04:10 (`scripts/backup_db.sh`; local 14d + off-site Cloudflare R2 encriptado gpg, 90d, teto 5 GB). Correr à mão antes de migração arriscada. Detalhe e recuperação: comentários do script.
- **Rollback:** `bash scripts/rollback.sh <tag|hash>` (`-f` c/ frontend) — repõe o clone do servidor numa ref + restart + health. Migrações são aditivas por regra (não fazem rollback).

## Git
Fluxo conforme o caso (commits pequenos quando ajuda; agrupar quando faz sentido). Mensagens claras, em português. **`git push` é livre.** Só reescrever histórico partilhado é paragem obrigatória (ver acima).

## Documentação — fontes de verdade
Mantém atualizados **após cada alteração que mude o que neles está** (não a cada commit trivial):
- **`Conceito_Historico_Precos_Voz.md`** — conceito, arquitetura, decisões abertas/fechadas (§10).
- **`Schema_e_Funcoes_ToolUse.md`** — schema da BD + contrato das funções/módulos.
- **`Normalizacao.md`** — normalização atual (problema, dificuldades, solução, lacunas).
- **`Taxonomia_Produto.md`** — modelo-alvo facetado (Produto Mestre); o norte da migração.
- **`Analise_Fontes_Normalizacao.md`** — fontes (números reais) + plano v2 (fases A/B/C/**D=classificação por catálogo**).
- **`Visao_Conselheiro_Saude_Alimentar.md`** · **`Vertical_Espanha_Mercadona.md`** · **`Paper_Resolucao_Produtos_Talao.md`** · **`Aula_Classificacao_Produtos.md`** (didático) · Runbook de bootstrap.

## Internacionalização (i18n)
- **Base PT-BR**, tratar o usuário por "você". **Nunca hardcodar texto visível** — incl. o gerado por LLM (os prompts pedem PT-BR + "você").
- **Frontend:** todo o texto da UI por `frontend/src/i18n.js` via `t('chave', vars)`. Traduzir = adicionar um dicionário. O `/admin` está fora do âmbito i18n.
- **Resolução do nome de um EAN é PT-first** (catálogo PT > OFF traduzido; marcas/nomes próprios nunca se traduzem; nomes PT-PT não se abrasileiram). Detalhe no Conceito.
- **Exceções (dados, não UI):** prompts internos de extração e nomes de produtos canónicos.

## Notas técnicas
- IA toda via **OpenRouter**, chave própria do BigBag (`OPENROUTER_API_KEY`, com limite de gasto). Áudio em base64.
- **Extração = `gemini-2.5-flash`** (`OPENROUTER_MODEL_EXTRACAO`); verificação = `gemini-3-flash-preview`. Custo é não-fator (<$0,01/nota); o barato perde itens.
- **~97% do custo é a ingestão** (metade leitura-VLM, metade normalização item-a-item). A alavanca é o **catálogo determinístico** (item resolvido sem LLM corta canonicalizar+mestre). A aba **Custos** mede por feature.
- Comparações de preço usam sempre `preco_por_base` (€/kg, €/L, €/un); filtrar `is_clearance`/`is_non_product`.
- **Preço de catálogo (online) é só referência, NUNCA critério** (dono, 2026-06-11): no matching entra só como bónus de desempate; o histórico de preços vem exclusivamente dos talões (facto).

---

## Estado atual (2026-06-14 · app v0.0.147.0 — fase BETA)

**Três superfícies** (routing por path em `frontend/src/main.jsx`):
- **App de chat (`/`)** — PWA do utilizador: notas (📷 câmara inteligente: barras→produto, senão→talão), perguntas, **lista/carrinho partilhada**, scanner, **despensa** (049), gastos, "por identificar", perfil nutricional. Produto → ficha factual + avaliação personalizada. Base LOCAL no telefone (IndexedDB) p/ scan instantâneo/offline. **Despensa INDEPENDENTE da lista (v0.0.149.0, decisão do dono):** ícone próprio no topo (armário, cor âmbar) com pílula de contagem — saiu do kebab; entrada SÓ pela tela de despensa (scan), já NÃO pelo scan→lista (que enchia a lista do que já se tem); mesmo formato rico da lista (`GET /despensa` reusa `resolverItensLista`: secção, marca, tamanho, preço + validade).
- **Operador (`/admin`)** — desktop. Abas: Painel · SKUs · Mestres · Ligar nomes · Nomes · EANs · Mercadona · Itens · Fichas · Revisão · Qualidade · Preços · Saúde · Uso · Custos.
- **Comprador (`/explorar`)** — desktop, tema "talão": explorar produtos, preço pago vs €/base, por mercado.

**Pipeline:** `POST /api/faturas` (câmara/galeria · ficheiro · Share Target Android) → VLM-imagem ou texto-PDF+LLM → extração com loop de auto-correção (reconcilia com o total) → dedup → normalização (formato→`preco_por_base`) → canonicalização + matching → verificação de nomes. **Consulta:** tool use (`POST /api/consulta` texto, `/api/voz`).

**Infra FECHADA:** Apache+Let's Encrypt, systemd porta 4200. BD `app_bigbag`, **migrações até 052** (lista no `Schema_e_Funcoes_ToolUse.md §1d`). Migrações novas: `mysql … < ficheiro` no servidor (aditivas por regra).

### Sistema de classificação (o eixo desta fase — detalhe nos docs-fonte)
- **Duas lentes** (dono, 2026-06-12): **de loja** (`it.grupo`, o corredor — segue como as lojas organizam; massa/arroz/cereais em *mercearia*) serve comparar/comprar; **da lista** (seção de exibição) é o cabeçalho da lista de compras. São eixos distintos de propósito.
- **`grupoDe`** (`normaliza/categoria.js`, módulo PARTILHADO front/back, puro): ordem dos sinais = congelados(loja) → **NOME** (nosso vocabulário) → food_groups OFF → categoria-loja. Invertida em 2026-06-13 (NOME antes do OFF crowdsourced); a ordem antiga contaminava o ouro do golden.
- **Resolvedor ÚNICO da ficha por EAN** (052, `normaliza/fichaEan.js`): a ficha é a FUSÃO campo-a-campo de TODAS as fontes locais, com **tabela de prioridades num só sítio**. Proveniência por campo + divergências em `produto_ean.fusao`; 'manual' sagrado; nutrição catálogo-oficial>OFF>VLM; ingredientes = o mais completo (anti-OCR, anti-estrangeiro); idempotente (testado). Backfill `refundir_fichas.mjs` aplica+regista diff.
- **Classificação por catálogo** (`normaliza/classificarCatalogo.js`, Fase D): as linhas de catálogo votam (EAN direto, ou ~80 vizinhos por nome), peso = profundidade do caminho, vencedor por **FAMÍLIA** (2.º nível). Seção da lista = tipo curado saliente > família (`cat_exib`) > grupo (3 iterações: corredor grosso, folha fina, família certa). Guardas anti-colisão de EAN, raso-não-vota, ES-não-exibe. Avaliador: `scripts/avaliar_classificacao_catalogo.mjs`.
- **Nome:** "à talão" (genérico da secção cortado; marca à parte noutra cor); quantidade embutida sai (`cortarQuantidadeNome`: "20 Saq", "… Saquetas"); verificação de nomes (037, voto a 3).
- **Auditoria mensal do scan:** `node scripts/auditar_grupos.mjs --scan` (juíz calibrado por canários) 1×/mês ou após sessão grande; adotar termos claros, regenerar golden no mesmo commit.

### Lista de compras (detalhe no Schema §lista_item)
Servidor é fonte de verdade, sync por polling, cores por membro, reconciliação com o talão, voz→lista. Sugestões por cadência + cartão de refeições (única chamada LLM, cacheada). ETag/304, Desfazer-o-esvaziar, **outbox offline completo** (`listaOutbox.js`, coalesce). **Cadeia de preço (v0.0.147.0):** FACTO por nome→SKU **e por EAN** (`item.ean` do talão + `produto_ean.item_id` da identificação — caso Picles-Aldi) → "~online" (menor catálogo do EAN) → "estimado" em 3 níveis (irmão→primo→primo-família, dieta nunca relaxa) → nada (honesto).

### Outros eixos construídos
- **Eixo saúde:** identificação por EAN (scan/foto/linha do talão) + OFF; ficha factual não-clínica; frescos por nome (`produto_generico`); perfil por membro com alertas de alergia; comparar na prateleira. Ver `Visao_Conselheiro`.
- **Fontes de catálogo ~60k** (`catalogo_produto`): Auchan/Continente (c/ EAN), Pingo Doce/Lidl (sem EAN), Mercadona ES, lidl-fr, mercadona-off. + `off_produto` (~27k, `consultarOFF` local-first com fallback à API live).
- **Ferramenta peso-pela-imagem** (`ingest/pesoImagem.js`, 051): VLM lê o peso da imagem do catálogo/OFF; fase 2 via SerpApi (Google CSE bloqueado pela conta IONOS). Lazy a partir da lista, 1×/EAN.
- **Telemetria de uso** (032) + **custos por feature** (`custo_chamada`).
- **Normalização v2 fases A/B** (035-036, 041-042): conteúdo→ppb, busca interna no catálogo, abreviaturas minadas, marca determinística, IVA por voto, categoria fechada, consulta por tokens. Estados no `Analise_Fontes`.

### Avisos e backlog vivos
- **Auth:** Google OAuth a aguardar redirect URI; entretanto portão `ENABLE_TEST_AUTH` (HTTP Basic, `TEST_USERS` no `.env`).
- **Sudo temporário** `90-bigbag-nopasswd` ainda ativo (instalação não terminou).
- **Continente scrape** bloqueado por anti-bot → cron noturno gota-a-gota (19,1k temos).
- **EANs do talão (Makro) válidos-mas-errados** (VLM troca dígito → outro EAN real); cruzar com a descrição (backlog).
- **Identificação por foto do produto errado:** falta prevenir (`corresponde_nota`) e corrigir (botão refazer no `ProdutoInfoSheet`).
- **Backlog:** eixo "reviews" (qualidade percebida, só processados — decidir se entra na visão); lista preditiva; agregado familiar; Fase C (busca web não-alimentares); `nif_comprador`→membro; famílias equivalentes entre lojas (Fase D3, semente: 3.421 EANs Auchan∩Continente); i18n leftovers; `/identificar` sem transação.

## Decisões em aberto (não inventar — opção segura + assinalar)
1. **Transcrição de voz:** STT separado vs. áudio-direto. **v1:** áudio-direto (`input_audio` base64), trocável em `transcricao.js`. Falta experimentar STT antes de fixar.
2. **OCR no dispositivo** (decisão #6 do Conceito) — só quando for app nativa. *(Leitura de fatura: FECHADA — VLM p/ imagem, texto-PDF+LLM p/ PDF.)*
3. Detalhe e decisões fechadas: `Conceito §10`.

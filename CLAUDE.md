# CLAUDE.md — Regras de trabalho neste projeto

Projeto pessoal de laboratório, **utilizador único**. PWA (React/Vite) + backend Node/Express + MySQL, no servidor de produção partilhado `85.25.46.6` (mesmo host de `pitacos.ai` e `1417`). App de histórico de preços de compras: lê faturas, guarda os dados, responde a consultas por nota de voz.

## Princípio geral
Trabalha com autonomia máxima. Decide sozinho tudo o que for **local e reversível** — estrutura de código, refactors, queries, migrações na BD do próprio projeto, escolha de bibliotecas, commits. Não peças permissão para isso. Pergunta o mínimo: quando algo for ambíguo e **reversível**, escolhe a opção razoável, segue em frente, e regista a suposição.

## Paragens obrigatórias (a ÚNICA lista de coisas a confirmar antes de executar)
Confirma comigo, mostrando o que vais correr, ANTES de:
1. Qualquer comando que toque em **serviços partilhados** do host — MySQL global, Apache, systemd, UFW, certbot — de forma que possa afetar `pitacos.ai` ou `1417`.
2. Qualquer **SQL de DDL/migração destrutiva** (DROP, TRUNCATE, ALTER que perca dados). Mostra o SQL antes. `GRANT` só em `app_<PROJ>.*`, nunca noutras bases.
3. **Apagar ou sobrescrever ficheiros** fora da árvore do projeto, ou ficheiros de dados/uploads já existentes.
4. **Reescrever histórico partilhado** (force-push, rebase de ramos partilhados). *(`git push` normal — incluindo para `main` — já NÃO precisa de confirmação.)*
5. **Revogar o sudo temporário** (`/etc/sudoers.d/90-<PROJ>-nopasswd`) — fá-lo no fim da instalação e confirma que ficou feito.
Fora desta lista, age sem perguntar.

## Isolamento (regra dura — herdada do runbook)
- Nunca tocar em MySQL/Apache/serviços dos outros projetos sem avisar.
- BD `app_bigbag`, user MySQL `bigbag` (GRANT só em `app_bigbag.*`), porta local **`4200`** (confirmada livre). Serviço `bigbag-backend.service`.
- Projeto corre sob o **user Linux partilhado `dev`** em `/home/dev/bigbag` (decisão do dono — reusa o `dev`, que já aloja o 1417; não há user dedicado). Domínio `bigbag.hal9klabs.com`.
- `.env` com `chmod 600`, **nunca versionado**. `.env` no `.gitignore` desde o primeiro commit. Segredos só em variáveis de ambiente, nunca hardcoded no código nem em ficheiros que vão a commit.
- Setup de servidor reutilizável (com segredos) vive **fora do repo**, no PC: `C:\ProjetosAI\Setup_Ambiente_Novo_Projeto_PRIVADO.md` (nunca comitar).

## Testar antes de dar por feito (obrigatório)
Uma tarefa só está concluída depois de verificada a funcionar — não basta compilar:
- Backend: o endpoint responde como esperado (curl ao `/health` e à rota nova); a migração aplica sem erro.
- As funções de tool use devem ser testáveis **por texto** antes de haver voz.
- Frontend: a build passa (`npm run build`) e o fluxo principal funciona no browser.
- Lógica pura (reconcile, formato) tem testes em `backend/test/*.test.mjs`. Os testes que tocam BD/LLM só correm no servidor (não há MySQL local no PC) — corre os de lógica com `node --test test/<ficheiro>.test.mjs`.
- Se algo não dá para testar automaticamente, di-lo explicitamente e descreve como verificaste à mão.
- Não marques nada como "feito" com um teste a falhar ou por correr.

## Git
Decide o fluxo conforme o caso (commits pequenos e focados quando ajuda; agrupar quando faz sentido). Mensagens de commit claras e em português. **`git push` é livre — não precisa de confirmação** (decisão do dono, 2026-06-06). Só **reescrever histórico partilhado** (force-push, rebase de ramos partilhados) é que continua a ser paragem obrigatória.

## Documentação — fontes de verdade
Mantém estes documentos atualizados **após cada alteração que mude o que neles está descrito** (não a cada commit trivial). O detalhe histórico vive nestes docs; o CLAUDE.md é só o panorama:
- **`Conceito_Historico_Precos_Voz.md`** — conceito, arquitetura, decisões em aberto/fechadas. Atualizar quando uma decisão fechar ou a arquitetura mudar.
- **`Schema_e_Funcoes_ToolUse.md`** — schema da BD e contrato das funções. Atualizar sempre que o schema ou uma função mude.
- **`Normalizacao.md`** — normalização **atual** (problema, dificuldades, solução, lacunas).
- **`Taxonomia_Produto.md`** — modelo-alvo **facetado** (standards OFF/GS1/IFPS, níveis, coorte, Produto Mestre); é o norte da migração incremental.
- **`Analise_Fontes_Normalizacao.md`** — análise das fontes de produto (números reais) + **plano da normalização v2** (fases A/B/C). Atualizar quando uma proposta avança.
- **`Visao_Conselheiro_Saude_Alimentar.md`** — **visão** do eixo saúde (nutrição herdada da classe via OFF, EAN opcional, "factual não clínico").
- **`Vertical_Espanha_Mercadona.md`** — ideia de produto: lançar para Espanha+Mercadona (backlog).
- **`Paper_Resolucao_Produtos_Talao.md`** — relatório técnico do método de resolução de entidades.
- **Runbook de bootstrap** (versão limpa, sem segredos) — passos de servidor.
- Quando fechares uma "decisão em aberto", regista a escolha e o porquê no `Conceito`.

## Estado atual (2026-06-12 · app v0.0.121.0 — fase BETA)

**Classificação tem DUAS lentes (decisão do dono, 2026-06-12):** **de loja** (`it.grupo`, o corredor — frutas/carne/…/mercearia/padaria; segue como as lojas organizam: massa/arroz/farinha/cereais em *mercearia*, padaria só pão/pastelaria) — preservada, serve comparar/explorar/comprar (mesmo corredor junto na loja); e **da lista** (`tipoConsumidor` no front, derivado do NOME — "o que a coisa É": Massa, Pão, Cereais, Conservas, e Mercearia residual) — é o cabeçalho de secção da lista de compras. "Massa" tem secção; "arroz" cai em Mercearia residual (bom senso, afina-se com o uso). A nutrição-por-classe (`DISPENSA_CLASSE`) é mecanismo SEPARADO, não muda.

**Três superfícies** (routing por path em `frontend/src/main.jsx`):
- **App de chat (`/`)** — PWA do utilizador: envia notas (📷 câmara **inteligente**: barras → consulta produto; senão → talão), faz perguntas, **carrinho/lista partilhada**, scanner de barras, **despensa = inventário por scan** (o ícone de barras na lista põe o produto na lista E na despensa "tenho em casa"; já NÃO deriva das compras — migração 049), gastos, "por identificar", perfil nutricional. Abrir produto → **ficha factual** (Nutri-Score/NOVA/réguas UE/parecer) + **avaliação personalizada** se houver perfil ativo. **Base LOCAL no telefone** (IndexedDB) → scan instantâneo/offline; cresce com o uso.
- **Operador (`/admin`)** — desktop. Abas: Painel · Produtos/SKUs · Mestres · Ligar nomes · Nomes · **EANs** (matching nome→EAN, operador é juiz) · **Mercadona** (talões PT × catálogo Mercadona ES) · Itens (item cru) · Fichas (editar produto por EAN) · Revisão · Qualidade · Preços · Saúde · **Uso** (telemetria) · **Custos** (gasto OpenRouter por feature/modelo/dia).
- **Comprador (`/explorar`)** — desktop, tema "talão": explorar produtos, preço pago vs €/base, variação, por mercado.

**Ingestão:** `POST /api/faturas` (vias: câmara/galeria · ficheiro · **Share Target Android** — app do LIDL et al. partilham o talão como imagem; iOS não suporta) → VLM-imagem ou texto-PDF+LLM → extração com **loop de auto-correção** (reconcilia com o total) → dedup robusta (4 redes) → normalização (formato→`preco_por_base`) → canonicalização + matching → **verificação de nomes** (2.ª opinião). Desconto de cartão NÃO espalhado pelos itens.

**Consulta:** 11 funções + tool use (`POST /api/consulta` texto, `POST /api/voz`), modelo `gemini-2.5-flash`.

**Infra FECHADA:** `https://bigbag.hal9klabs.com` (Apache+Let's Encrypt), `bigbag-backend.service` (systemd, porta 4200). BD `app_bigbag`, **migrações até 048** (013-032 base; 033 nutricao_confirmada; 034 lista_compras; 035 conteúdo da embalagem; 036 marca_origem; 037 verificacao_nome; 038 off_produto; 039 chave larga em produto_analise; 040 catalogo nome_pt; 041 sku.grupo; 042 fatura nif_comprador+forma_pagamento; 043 facetas do Mestre como colunas; 044 produto_ean campos largos; 045 catalogo ean_inferido; 046 catalogo descricao_curta; 047 catalogo nutricao oficial; 048 colação única; 049 despensa (inventário por scan); 050 lista_item.ean (liga item do scan ao produto exato)). Migrações novas: aplicar com `mysql … < ficheiro` no servidor.

**O que está construído (detalhe nos docs-fonte):**
- **Eixo saúde** — identificação por EAN (scan/foto/linha do talão) + OFF; ficha factual não-clínica; frescos por nome (`produto_generico`); perfil por membro com alertas determinísticos de alergia; comparar produtos na prateleira. Modelo de **3 níveis de nome** (nota → produto real por EAN → nome canónico sem marca). Ver `Visao_Conselheiro`.
- **Normalização v2 FASES A e B** (migrações 035-036, 041-042) — A: conteúdo da embalagem→ppb, motor de busca interno (`buscarCatalogo`), dicionário de abreviaturas minado, marca determinística pré-LLM (`marca_origem`), IVA por voto maioritário, vocabulário único de facetas. B: **categoria fechada** (`sku.grupo`, 11 valores, `normaliza/categoria.js`), **consulta por tokens** (matchProduto em cascata: grupo→tokens-cabeça→fuzzy→LIKE; "leite" já não mistura "Doce de Leite"), **NIF do comprador + forma de pagamento** na extração, filtro de cabeçalhos de secção. Ver `Analise_Fontes_Normalizacao.md` (estados nas secções Fase A/B) e `Normalizacao.md`.
- **Verificação de nomes** (migração 037) — o nome é o único campo sem checksum; suspeita grátis → 2.ª opinião VLM de outra família → voto a 3 (corrige sozinho só com confirmação do catálogo). Ver Conceito §4.
- **Fontes de catálogo ~60k** (`catalogo_produto`) — Auchan/Continente (scrape, c/ EAN), Pingo Doce/Lidl (sem EAN), **Mercadona** (API JSON ES), **lidl-fr** (lista QCE FR), **mercadona-off** (own-brand do OFF, nomes PT). + `off_produto` (dump do OFF, ~27k, **`consultarOFF` local-first com fallback à API live quando a linha local não tem nutrição — completa e cura o dump**).
- **Lista de compras partilhada** (3 fases, migração 034) — servidor é fonte de verdade, sync por polling, cores por membro, reconciliação com o talão, listas individuais, voz→lista. **Lista inteligente fase 1 (v0.0.108.0):** por item, `produto_sugerido`/`variantes_n`/`qtd_habitual` derivados do histórico (chips na UI; seletor de variantes habituais; `PATCH nome` concretiza) — determinístico, zero LLM. **Pente-fino Sprint 1 (v0.0.111.0):** consolidação por chave normalizada (`chaveItemLista`: "Ovo"="ovos", plurais singularizados — soma em vez de duplicar), `POST /lote` (voz num round-trip), barra "Entendi: …" editável, `PATCH {inc}` por delta (concorrência soma), guarda anti-`[object Object]`, item chega animado (sem toast). **Lista mágica (v0.0.112.x):** sugestões por CADÊNCIA (intervalo mediano por SKU vs dias desde a última, urgência 0.85–3× — acima é hábito abandonado; estado vazio "✨ Começar por mim"; zero LLM) + **cartão de refeições** (a única chamada LLM, `gemini` via modelConsulta, cache em memória por hash dos itens — mesma lista nunca paga 2x, gate ≥4 alimentares, custo em `lista-refeicoes`). **Sprint 2 (v0.0.113.0):** `GET /lista` com **ETag/304** (poll de 3s salta o resolver caro quando nada mudou; sig = mercado + `MAX(item.id)` p/ invalidar preços), cache de `sku_normalizado` 30s, **Desfazer o esvaziar** (snackbar 7s; `/limpar` devolve snapshot `{id,estado}`, `/restaurar` repõe carrinho-vs-ativo exato). **Outbox offline completo (v0.0.114.0):** marcar/incrementar/qtd/remover/renomear feitos offline vão à fila e sincronizam (antes só as adições sobreviviam). Operações COALESCEM (`frontend/src/listaOutbox.js`, puro + 12 testes em `backend/test/listaOutbox.test.mjs`: 5 toques no "+" = inc 5; riscar+desriscar = nada; remover anula pendências) e itens criados offline (id `tmp…`) são remapeados para o id real quando o `add` é aceite. Fases seguintes: mercado recomendado p/ a lista, selos de perfil, ruptura preditiva.
- **Telemetria de uso** (migração 032) self-hosted + **custos por feature** (`custo_chamada`; todas as chamadas LLM/VLM agora registadas, incl. as que usavam fetch direto).
- **Vertical Espanha+Mercadona** (backlog) — onde o problema multi-cadeia colapsa; à espera de talão ES real. Ver `Vertical_Espanha_Mercadona.md`.

**Avisos e backlog vivos:**
- **Auth:** Google OAuth a aguardar redirect URI; entretanto **portão `ENABLE_TEST_AUTH`** (HTTP Basic, users em `TEST_USERS` do `.env`) protege as rotas. Trocar pelo OAuth quando pronto.
- **Sudo temporário** `90-bigbag-nopasswd` ainda ativo (instalação não terminou).
- **Continente scrape** bloqueado por anti-bot (471/474 ao IP) → **cron noturno gota-a-gota** desde 17/06 (circuit-breaker de 25 erros); 19,1k já temos. Google CSE 403 (busca web nome→EAN, parado).
- **EANs do talão (Makro) válidos-mas-errados** — o VLM pode trocar um dígito e dar outro EAN real; para não-food, backlog cruzar com a descrição / busca web (Brave, `country=PT`).
- **Identificação por foto do produto errado** — falta (a) prevenir (passar `descricao_original` ao VLM, veredicto `corresponde_nota`) e (b) corrigir (botão remover/refazer no `ProdutoInfoSheet`).
- **Backlog:** **eixo "qualidade percebida" (reviews)** — 3.º eixo a juntar a preço+saúde: avaliações de consumidores p/ desempatar marcas equivalentes NA PRATELEIRA. Só vale nos **processados** (num básico como massa as reviews são ruído — "boa massa, 5★"; a classe já decide); fronteira igual à do veredicto-por-produto. Cuidado: dado mais difícil de obter limpo (anti-bot/ToS no Amazon/Google; agregadores estruturados são pagos) e é subjetivo (muda a postura "factual" da app). Decidir se entra na visão antes de construir. (Ideia 2026-06-12, conversa do caso Barilla Penne.) lista de compras **preditiva** ("para X dias→N unidades", algoritmo da tese MSc); **agregado familiar** (consumo partilhado); Fase C da normalização (busca web não-alimentares, embeddings só se preciso); usar `nif_comprador` p/ atribuir compra ao membro (UI); Auditoria UX (`design/review/Auditoria_UX_PLANO.md`); colapsar itens iguais com nº de unidades diferente (aba Itens); i18n leftovers (PerfilSheet, ResultadoIdent, aria-labels); `/identificar` sem transação.

## Decisões ainda em aberto (não inventar — usar a opção segura e assinalar)
1. **Transcrição de voz:** STT separado vs. áudio-direto ao LLM. **v1 em uso:** áudio-direto via chat (`input_audio` base64), de forma trocável em `transcricao.js`. Falta experimentar STT-separado antes de fixar.
2. ~~**Leitura de fatura:** VLM direto vs. OCR+LLM.~~ **FECHADA (2026-06-07):** VLM p/ imagem, texto-do-PDF+LLM p/ PDF; OCR dedicado p/ fotos rejeitado (com Tesseract). Ver Conceito §4. **Reaberta como decisão #6 (OCR nativo no telefone) — só quando for app nativa.**
3. ~~**Autenticação**~~ **FECHADA (2026-06-04):** servidor exposto à internet → Google OAuth + `SUPERUSER_EMAIL` (portão temporário até ativar).
- Outras decisões em aberto/fechadas detalhadas no `Conceito §10` (identidade EAN vs nome, anti-foto-errada, **#6 OCR no dispositivo**).

## Internacionalização (i18n) — base PT-BR, código localizável
- **Idioma base: português do Brasil (PT-BR)**, tratando o usuário por "você". Mas **nunca hardcodar texto visível** ao usuário — codificar de forma a permitir tradução fácil. Aplica-se a **TODO o texto enviado ao usuário**, incluindo o **gerado por LLM** (os prompts pedem explicitamente PT-BR + "você").
- **Resolução do NOME de um EAN (PT-first, `consultarOuGuardar`)** — o mesmo EAN aparece em várias fontes, muitas vezes em línguas diferentes (caso real: Barilla Penne `8076802085738` = "Massa Penne Rigate Barilla" no Continente, "Penne Rigate No. 73 Durum Wheat…" no OFF). Ordem de preferência do nome: **(1) nome de loja PT do nosso catálogo para o MESMO EAN** (`nomeCatalogoPt`: `nome_pt` do Mercadona → loja PT Continente/Auchan/… → null; ganha ao OFF, melhor que traduzir e mais limpo); **(2)** senão, o nome do OFF **traduzido para PT** (`ingest/traduz.js`; marcas/nomes próprios nunca). Tradução em fundo na ficha; **síncrona no scan→lista** (`{traduzir}` via `?pt=1`) p/ o estrangeiro não chegar à lista. O ramo "já em base" **cura** o nome guardado em fundo (ficha/despensa/base-local convergem p/ PT). *Nomes PT-PT entre si NÃO se abrasileiram* (decisão 2026-06-10). **Aberto:** o MESMO produto com **EANs diferentes** (variantes/países) ainda resolve independente — é o problema do Mestre/resolução de entidades.
- **Frontend:** todo o texto da UI passa por `frontend/src/i18n.js` via `t('chave', vars)` (interpolação `{var}`, plural `{n|sing|plur}`). **Traduzir = adicionar um dicionário**; os componentes não mudam. O `/admin` (operador=dono) está **fora do âmbito** i18n.
- **Backend (respostas do assistente):** idioma centralizado no system prompt (`consulta.js`); locale-driven quando houver 2.º idioma.
- **Exceções (dados, não UI):** prompts internos de extração e os nomes de produtos canónicos.

## Notas técnicas
- IA toda via **OpenRouter** (compatível OpenAI), uma chave **própria do BigBag** (`OPENROUTER_API_KEY`, com limite de gasto; trocada da partilhada em 2026-06-11). Áudio em base64 (URLs não suportados para áudio).
- **Modelo de extração = `gemini-2.5-flash`** (`OPENROUTER_MODEL_EXTRACAO`). Benchmark de 5 VLMs (Conceito §4.3): o mais barato erra/perde itens (falsa economia); custo é não-fator (<$0,01/nota). `OPENROUTER_MODEL_VERIFICACAO` (2.ª opinião) = `gemini-3-flash-preview`.
- **Custo:** ~97% é a ingestão de talões — metade leitura-VLM, metade normalização item-a-item por LLM. A alavanca de poupança é o **catálogo determinístico** (cada item resolvido sem LLM corta canonicalizar+mestre); a aba Custos mede por feature.
- `OPENROUTER_TIMEOUT_MS` — vigiar; pode ser curto para imagem grande num VLM.
- Comparações de preço usam sempre `preco_por_base` (€/kg, €/L, €/un); filtrar `is_clearance` e `is_non_product`.
- **Preço de CATÁLOGO (online) é só referência, nunca critério** (decisão do dono, 2026-06-11): pode divergir da loja física e mudar de um dia para o outro. No matching entra apenas como **bónus de desempate** (nunca penaliza nem decide — `bonusPreco`, marca manda sobre preço); o **histórico de preços vem exclusivamente dos talões** (preço pago, facto). Mostrar preço de catálogo sempre como aproximação. **Na lista (v0.0.121.0):** item scaneado nunca comprado → mostra-se o **menor preço de embalagem do catálogo entre lojas** como REFERÊNCIA ("~€x · online", itálico ténue, via `aplicarPrecoRef`/`lista_item.ean`); entra no total estimado mas nunca como facto/critério.
- PWA: testar câmara e microfone em **dispositivo real** (sobretudo iOS/Safari), não só no desktop.

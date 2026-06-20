# Autenticação — Zitadel (IdP OIDC self-host, partilhado entre apps)

> **Estado (2026-06-15, app v0.0.182.0):** serviço de auth **no ar e funcional**; BigBag integrado (login OIDC + allowlist). **Login GOOGLE a FUNCIONAR** — o utilizador entra e regista-se pelo Google (allowlist por email dá o acesso). O `ENABLE_TEST_AUTH` (HTTP Basic) continua como fallback. **Falta:** rotacionar o PAT (exposto) + SMTP no Zitadel.

## Decisão e princípio
Objetivo do dono (2026-06-14): um serviço de autenticação **próprio, reutilizável entre vários apps**, para dezenas de milhares de utilizadores, **sem custo por-MAU** e **sem auth feito à mão** (a superfície de segurança — reset, rotação de tokens, MFA, anti-enumeração — é onde os apps reais são hackeados). Escolha: **rodar um IdP OIDC open-source que é nosso**, não SaaS por-MAU nem código próprio. Motor: **Zitadel** (multi-project nativo = vários apps com acesso isolado; OIDC/social/MFA prontos; Go leve; self-host grátis).

**Modelo multi-app:** cada app = um **client OIDC** no Zitadel. A **autorização por-app vive na BD/config de cada app** (o token identifica o utilizador via `sub`/email; NÃO se mete `allowed_apps` no token → revogação instantânea, dados isolados). SSO vem de graça (é OIDC). Adicionar um app novo = registar mais um client (por API, reproduzível).

## Infra
- **Zitadel v4** + **PostgreSQL 16** em **Docker** no host partilhado (85.25.46.6), em **`/home/dev/auth/`** (`docker-compose.yml`), ligados a **`127.0.0.1:8088`** (Postgres só interno).
- **Apache** reverse-proxy de **`https://auth.hal9klabs.com`** → 127.0.0.1:8088 (vhost `auth.hal9klabs.com.conf` + `-le-ssl.conf`, **Let's Encrypt** auto-renova). Mesmo padrão do bigbag/torcida/1417.
- Gerir: `cd /home/dev/auth && sudo docker compose ps|logs|restart|up -d`.
- **Login UI:** a Login V2 (UI nova do v4) corre num container à parte que NÃO subimos → dava "Not Found". Desligada via `ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=false` (no compose) → usa a **login legacy** (totalmente funcional: password/social/MFA/reset). *Upgrade futuro opcional: subir o container da Login V2.*

### Segredos — `/home/dev/auth/.env` (600, FORA do git)
- `ZITADEL_MASTERKEY` — **CRÍTICA**: encripta os dados do Zitadel. Perdê-la = dados irrecuperáveis. **Copiar para o gestor de senhas.**
- `ZITADEL_DB_PASSWORD` — Postgres.
- `ZITADEL_PAT` — token do service user p/ automação por API. *(Foi colado no chat 2026-06-14 → ROTACIONAR.)*

## Endpoints / IDs (org "ZITADEL", domain `zitadel.auth.hal9klabs.com`)
- Issuer `https://auth.hal9klabs.com` · discovery `/.well-known/openid-configuration` · JWKS `/oauth/v2/keys` · authorize `/oauth/v2/authorize` · token `/oauth/v2/token` · userinfo `/oidc/v1/userinfo` · console `/ui/console`.
- **Admin:** `zitadel-admin@zitadel.auth.hal9klabs.com`.
- **Service user `bigbag-iac`** (Org Owner) + PAT → API de gestão `/management/v1/...` (criar projetos/apps/users reproduzível).
- **BigBag** = projeto `377443447096737795`; app **BigBag PWA** clientId **`377443508467859459`** — tipo **USER_AGENT + PKCE** (público, sem segredo), access token **JWT**, redirect `https://bigbag.hal9klabs.com/callback`, post-logout `https://bigbag.hal9klabs.com/`.
- **Utilizadores: NÃO pré-criar** (lição 2026-06-15). Os 2 pré-criados (gviberti3/suerocha) ficaram `USER_STATE_INITIAL` (sem password, por ativar) e o Google não os ligava sem ativação por email — e **não há SMTP** → beco sem saída. **Apagados.** Agora cada utilizador **regista-se sozinho** pelo Google (External User Not Found → **Register** → Zitadel cria-o do email **verificado pelo Google**, ativo na hora, sem password nem SMTP). Quem controla o acesso ao BigBag é a **allowlist por email** (`AUTH_ALLOWLIST`), não o Zitadel.
- **Quem pode entrar pelo Google:** (a) o email tem de ser **Test user** no OAuth consent screen do Google Cloud (modo Testing) — senão o Google bloqueia; (b) o email tem de estar na **allowlist** do BigBag. Allowlist atual: gviberti3@gmail.com, suerocha@gmail.com.

## Integração no BigBag (código)
- **Backend** `backend/src/auth.js` — `requireAuth` aceita, por ordem:
  1. **Bearer JWT** do Zitadel: valida assinatura via JWKS + issuer (`jose`); obtém o **email** (do token ou `/userinfo` cacheado); exige email na **allowlist** (`config.auth.allowlist` ← `AUTH_ALLOWLIST` no `.env` do BigBag). 403 = autenticado mas fora da allowlist.
  2. **HTTP Basic** (`ENABLE_TEST_AUTH`/`TEST_USERS`) — fallback durante a migração.
  - `config.auth.oidcIssuer` (`OIDC_ISSUER`, default `https://auth.hal9klabs.com`). Dep: `jose`.
- **Frontend** `frontend/src/auth/oidc.js` (`oidc-client-ts`, PKCE): `oidcLogin()` → `signinRedirect`; `oidcCallback()` na rota **`/callback`** (em `main.jsx`) troca código→tokens; `oidcAccessToken()` (renova com refresh token). `api.js` manda o access token como **Bearer** (Basic de fallback). `LoginV2` (v2): botão "Entrar" (OIDC) + "acesso de teste" (Basic, escondido). Ecrã "sem acesso" no 403. v1 (`/v1`, congelada) fica com Basic.
- **`deploy.sh`** faz `npm install` no backend E frontend (deps novas: `jose`, `oidc-client-ts`).

## Operações
- **Adicionar utilizador à allowlist:** criar o user no Zitadel (console Users→New, ou API) **e** acrescentar o email a `AUTH_ALLOWLIST` no `.env` do BigBag (`/home/dev/bigbag/.env`) + restart `bigbag-backend`.
- **Adicionar um app novo:** criar um client OIDC no projeto certo (API `/management/v1/projects/{id}/apps/oidc` com o PAT) + o app valida o JWT e tem a sua própria allowlist.
- **Org real do PAT/projetos:** org **ZITADEL** `377442061785300995` (domínio `zitadel.auth.hal9klabs.com`) — é AQUI que vivem os projetos (BigBag e novos). O id `377532243414876163` do doc é o **IdP Google**, ligado à *login policy* desta org → qualquer projeto novo nesta org herda o botão "Sign in with Google" sem tocar no Google (o OAuth client do Google é partilhado; o redirect do Google é o do login do Zitadel, não o do app).

### Apps registados (multi-app)
- **BigBag** — projeto `377443447096737795`, client `377443508467859459`, `https://bigbag.hal9klabs.com`.
- **Noteca** (ex-"Anotai"; renomeado 2026-06-20) — app de notas fiscais/gastos (BR). Repo `hal9klabs/lerqrcode`, em `/home/dev/lerqrcode`, serviço `lerqrcode-backend` (porta **4300**), domínio **`noteca.app`** (Cloudflare/GoDaddy → 85.25.46.6, Apache+Let's Encrypt). `anotai.hal9klabs.com` continua vivo na transição.
  - **Zitadel:** projeto `378001634904506371` (renomeado "Noteca"). **Client WEB** `378001635139387395` (USER_AGENT+PKCE, JWT), redirects `https://noteca.app/callback` (+ `anotai.hal9klabs.com` + localhost, transição), **Login V2 base → `https://noteca.app`** (usa a UI de login PRÓPRIA do app). **Client NATIVE** (Android/Capacitor) `378142509764706307` (NATIVE+PKCE), redirect **`app.noteca:/callback`** (+ `com.hal9klabs.lerqrcode:/callback`, transição); package id **`app.noteca`**.
  - **Login PRÓPRIO (telas estilo Pitacos) sobre a Session API v2** (não a página hosted): backend orquestra `v2/sessions`+`v2/users`+`v2/idp_intents`+`v2/oidc/auth_requests` com um **machine user `anotai-login` (papel `IAM_LOGIN_CLIENT`)** + PAT em `/home/dev/anotai-login.pat` → `.env` do app como `ZITADEL_LOGIN_TOKEN` (nunca ao browser). Google (criar/ligar conta na org partilhada) + e-mail/senha. **GOTCHA:** o `PATCH /v2/sessions` (password) devolve um sessionToken NOVO — usar ESSE ao finalizar. Guias: `C:\ProjetosAI\Anotai_Auth_Integracao.md` + `Anotai_Guia_SessionAPI.md`.
  - **Google:** IdP Google DEDICADO do Noteca `378093835420434435` (≠ do BigBag), ligado a um **projeto Google PRÓPRIO** `anotai-499907` (renomeado "Noteca"), OAuth client `899584624845-…`, redirect = `https://auth.hal9klabs.com/idps/callback`. Consent **"Noteca" PUBLICADO** (scopes não-sensíveis; domínio `noteca.app` verificado no Search Console + marca verificada). *(Correção: o consent do Noteca NÃO é partilhado com o BigBag — cada um tem o seu projeto Google.)*
  - **E-mails:** SMTP do Zitadel = **Resend** (`smtp.resend.com:587`). Mas o **código de verificação/reset é NUMÉRICO de 6 dígitos gerado pela APP** e enviado por ela via **API do Resend** (`RESEND_API_KEY`+`RESEND_FROM=noreply@noteca.app` no `.env`), usando `returnCode` (o Zitadel devolve o código DELE ao backend, a app mostra o seu) — porque a v4.15.1 não deixa mudar o formato do código (alfanumérico). Domínio `noteca.app` verificado no Resend (região São Paulo).
  - **Acesso ABERTO** (qualquer Google + qualquer e-mail/senha, **SEM allowlist**); dados isolados por `sub`; rate-limit. Política/Termos/Ajuda em `noteca.app/{privacidade,termos,ajuda}/`.
  - **Falta (cut-over final):** aposentar `anotai.hal9klabs.com` (remover vhost + os redirects `anotai.hal9klabs.com`/scheme `com.hal9klabs.lerqrcode` dos clients). `devMode=true` nos clients (localhost) → desligar antes de fechar.
- **Rotacionar o PAT:** console → `bigbag-iac` → Personal Access Tokens → apagar+novo → atualizar `/home/dev/auth/.env`.

## Google login — FEITO (2026-06-15)
- **Google Cloud:** OAuth client (Web), redirect URI = **Login V1** `https://auth.hal9klabs.com/ui/login/login/externalidp/callback` (NÃO o V2 `…/idps/callback` — usamos a login legacy). Consent screen em Testing → emails como **Test users**. Client ID `467921416677-…apps.googleusercontent.com`.
- **Zitadel:** IdP Google na **org BigBag** (id `377532243414876163`), **Activate** liga-o à política de login (botão "Sign in with Google"). Segredo só no Console (nunca no chat/git). PAT do `bigbag-iac` gere a ORG via Management API (`/management/v1/...`) mas **não a instância** (`/admin/v1` dá "No matching permissions").
- **Bug destravado:** `auth.js` deixou de mandar `WWW-Authenticate: Basic` no 401 — o browser abria o diálogo nativo de Basic e tapava o ecrã de login OIDC.

## Falta / próximos
1. **Rotacionar o PAT** (exposto no chat + no `zitadel.txt` do repo público).
2. **SMTP no Zitadel** (envio de emails: verify/reset). Sem isto, ativações por email não funcionam (daí o "não pré-criar users").
3. Mapear `sub`/email do Zitadel à **identidade/dados existentes** (hoje single-user "gustavo"); multi-tenant a sério com muitos utilizadores.
4. Hardening opcional: **BFF** (cookie httpOnly) em vez de tokens no browser; subir a **Login V2**.

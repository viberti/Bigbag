# Autenticação — Zitadel (IdP OIDC self-host, partilhado entre apps)

> **Estado (2026-06-14, app v0.0.170.0):** serviço de auth **no ar e funcional**; BigBag integrado (login OIDC + allowlist). **Falta** o método de login dos utilizadores → **Google login** (próximo passo). O `ENABLE_TEST_AUTH` (HTTP Basic) continua como fallback durante a migração.

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
- **Utilizadores** (allowlist do BigBag): `gviberti3@gmail.com` (377444212456554499), `suerocha@gmail.com` (377444212540440579) — email verificado, **sem password** (entram por Google quando estiver ligado).
- **Auto-registo DESLIGADO** (org login policy `allowRegister=false`): só pré-cadastrados.

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
- **Rotacionar o PAT:** console → `bigbag-iac` → Personal Access Tokens → apagar+novo → atualizar `/home/dev/auth/.env`.

## Falta / próximos
1. **Google login** (ambos os users são @gmail): criar **OAuth client no Google Cloud** (redirect `https://auth.hal9klabs.com/ui/login/login/externalidp/callback`) → configurar **Google como IdP** no Zitadel (API) + na login policy → aparece "Sign in with Google".
2. Mapear `sub`/email do Zitadel à **identidade/dados existentes** (hoje single-user "gustavo"); multi-tenant a sério quando houver muitos utilizadores.
3. Hardening opcional: **BFF** (cookie httpOnly) em vez de tokens no browser; subir a **Login V2**.

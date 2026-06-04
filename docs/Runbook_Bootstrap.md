# Runbook de Bootstrap — Bigbag (versão limpa, sem segredos)

> **Fonte de verdade dos passos de servidor.** Este ficheiro vai a commit e **não contém credenciais**: valores reais (passwords MySQL, chave OpenRouter, segredos OAuth) vivem só no `backend/.env` (chmod 600), nunca aqui nem no repositório.
>
> **Servidor partilhado.** Produção em `85.25.46.6`, host partilhado com `pitacos.ai` e `1417`. Tudo o que toque em serviços partilhados (MySQL global, Apache, systemd, UFW, certbot) ou seja DDL destrutiva é **paragem obrigatória**: os comandos são mostrados e confirmados antes de correr (ver `CLAUDE.md`).

---

## 0. Convenções do projeto

| Item | Valor |
| --- | --- |
| Projeto | `bigbag` |
| Utilizador Linux | **`dev`** (partilhado neste host; já aloja o `1417`). Decisão do dono (2026-06-04): reusar o utilizador `dev` em vez de criar um dedicado. Isolamento mantém-se ao nível de **BD/user MySQL/porta/serviço systemd**. |
| BD MySQL | `app_bigbag` |
| User MySQL | `bigbag` — `GRANT` só em `app_bigbag.*` |
| Porta local backend | `4200` (**confirmado livre** por `ss -tln` em 2026-06-04) |
| Serviço systemd | `bigbag-backend.service` |
| Raiz da app | **`/home/dev/bigbag`** (clone do repo; criado a 2026-06-04, dono `dev:dev`) |
| Uploads faturas | `/var/lib/bigbag/comprovantes` |
| Uploads notas de voz | `/var/lib/bigbag/notas_voz` (acrescento ao runbook do 1417) |
| Auth | Google OAuth + `SUPERUSER_EMAIL` (servidor exposto à internet — Conceito §7) |

---

## 1. Reconhecimento (🛑 mostrar antes) — NÃO destrutivo, mas valida o host

```sh
ss -tln                       # porta 4200 livre? que portas usam os vizinhos?
id bigbag 2>/dev/null         # utilizador já existe?
ls /var/lib/ | grep -i bigbag # diretórios já existem?
sudo mysql -e "SHOW DATABASES LIKE 'app_bigbag';"  # BD já existe?
```

Objetivo: garantir que não colidimos com `pitacos.ai`/`1417`. Se 4200 estiver ocupada, escolher a próxima porta livre e atualizar este runbook + `.env`.

## 2. Diretórios (🛑) — utilizador `dev` já existe, não se cria

O projeto vive sob o utilizador partilhado `dev` (reaproveitado, como o `1417`). Não se cria utilizador novo.

```sh
sudo mkdir -p /home/dev/bigbag                                  # raiz da app (feito 2026-06-04)
sudo mkdir -p /var/lib/bigbag/comprovantes /var/lib/bigbag/notas_voz
sudo chown -R dev:dev /home/dev/bigbag /var/lib/bigbag
```

## 3. MySQL global — BD, user e GRANT restrito (🛑, mostrar SQL antes)

```sql
CREATE DATABASE IF NOT EXISTS app_bigbag
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'bigbag'@'localhost' IDENTIFIED BY '<no .env, não aqui>';
GRANT ALL PRIVILEGES ON app_bigbag.* TO 'bigbag'@'localhost';  -- só app_bigbag.*, nunca outras bases
FLUSH PRIVILEGES;
```

## 4. Migração inicial do schema (🛑 — DDL; mostrar SQL antes)

As 4 tabelas (`loja`, `sku_normalizado`, `fatura`, `item`) de `docs/Schema_e_Funcoes_ToolUse.md`. BD vazia, logo reversível, mas como é DDL no MySQL do host trata-se como paragem: mostrar o `CREATE TABLE` antes de aplicar.

## 5. Backend + .env (não-🛑 na app; 🛑 só se mexer em serviço partilhado)

```sh
# como utilizador dev, na raiz da app:
git clone <repo> /home/dev/bigbag           # ou git pull --ff-only origin main
cd /home/dev/bigbag/backend
npm ci --omit=dev
cp .env.example .env && chmod 600 .env       # preencher valores reais
node src/server.js                           # arranque manual de teste → /health
```

## 6. Serviço systemd `bigbag-backend.service` (🛑)

Unit com `WorkingDirectory=/home/dev/bigbag/backend` (dotenv lê o `.env` de lá), `User=dev`, `ExecStart=/usr/bin/node src/server.js`, `Restart=on-failure`. Depois `systemctl daemon-reload && systemctl enable --now bigbag-backend`.

## 7. Apache — vhost proxy + estáticos (🛑)

Vhost que serve `frontend/dist/` e faz proxy `/api` → `127.0.0.1:4200`. `LimitRequestBody` ~12 MB (chega para áudio curto + foto de fatura). **Não tocar nos vhosts de `pitacos.ai`/`1417`.**

## 8. HTTPS — Let's Encrypt / certbot (🛑)

`certbot --apache` para o domínio do Bigbag. Não renovar/alterar certificados dos vizinhos.

## 9. UFW (🛑)

**Libertar SSH (22) ANTES de habilitar**, depois 80/443. `sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable`.

## 10. Smoke test (testar antes de dar por feito)

```sh
curl -s https://<dominio>/health   # → {"status":"ok",...}
systemctl status bigbag-backend    # active (running)
```

## 11. Revogar sudo temporário (🛑 — regra 5 do CLAUDE.md)

No fim da instalação, remover `/etc/sudoers.d/90-bigbag-nopasswd` e **confirmar que ficou feito**.

---

## Segurança recorrente (Blocos 2 e 3)

- `.env` chmod 600, nunca versionado.
- App exposta → **rotas de upload e de consulta exigem sessão autenticada** (middleware de auth). `SUPERUSER_EMAIL` controla *quem* entra; o middleware impede chamadas *anónimas*. Duas camadas, ambas necessárias (Conceito §7).
- `OPENROUTER_TIMEOUT_MS=20000` herdado — vigiar com imagens de fatura grandes em VLM.

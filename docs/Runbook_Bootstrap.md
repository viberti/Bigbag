# Runbook de Bootstrap — Bigbag (versão limpa, sem segredos)

> **Fonte de verdade dos passos de servidor.** Este ficheiro vai a commit e **não contém credenciais**: valores reais (passwords MySQL, chave OpenRouter, segredos OAuth) vivem só no `backend/.env` (chmod 600), nunca aqui nem no repositório.
>
> **Servidor partilhado.** Produção em `85.25.46.6`, host partilhado com `pitacos.ai` e `1417`. Tudo o que toque em serviços partilhados (MySQL global, Apache, systemd, UFW, certbot) ou seja DDL destrutiva é **paragem obrigatória**: os comandos são mostrados e confirmados antes de correr (ver `CLAUDE.md`).

---

## Estado do bootstrap (2026-06-08)

| Passo | Estado |
| --- | --- |
| 1.1 Reconhecimento (porta 4200 livre) | ✅ feito |
| 2. Utilizador `dev` + dirs `/home/dev/bigbag`, `/var/lib/bigbag/{comprovantes,notas_voz,produtos}` | ✅ feito |
| 3. MySQL `app_bigbag` + user `bigbag` (GRANT só em `app_bigbag.*`) | ✅ feito |
| 4. Migrações **001→027** (todas por ordem) | ✅ aplicadas |
| 5. Backend + `.env` (chmod 600) + `npm ci` + smoke test `/health` | ✅ feito |
| 5b. Frontend `npm install` + `npm run build` (dep. `@zxing/browser` p/ scanner) | ✅ feito |
| 6. systemd `bigbag-backend.service` (enabled, auto-restart testado) | ✅ feito |
| 7. Apache vhost `bigbag.hal9klabs.com` (serve `frontend/dist/`, proxy `/api`) | ✅ feito |
| 8. HTTPS (certbot) + redirect http→https | ✅ feito (público) |
| 9. UFW | ✅ já correto (22/80/443; backend só localhost) |
| Bloco 2 — ingestão (`POST /api/faturas`, atrás de auth) | ✅ a funcionar (VLM imagem / texto-do-PDF+LLM, sinal honesto de reconciliação) |
| Bloco 3 — funções de consulta + tool use + testes | ✅ feito; rotas `POST /api/consulta` (texto) e `POST /api/voz` expostas |
| Conselheiro de saúde — EAN/fotos, nutrição factual, perfis | ✅ a funcionar (`/api/produto`, `/api/perfil`) |
| Auth — Google OAuth | ⏸️ no `.env`, a aguardar redirect URI na Google Console; **portão temporário** `ENABLE_TEST_AUTH` ativo entretanto |
| **11. Revogar sudo temporário** `/etc/sudoers.d/90-bigbag-nopasswd` | ⏸️ **ainda ativo** (instalação não terminou; revogar no fim) |

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
| Fotos de produto | `/var/lib/bigbag/produtos` (rótulos/EAN do conselheiro de saúde) |
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
sudo mkdir -p /var/lib/bigbag/comprovantes /var/lib/bigbag/notas_voz /var/lib/bigbag/produtos
sudo chown -R dev:dev /home/dev/bigbag /var/lib/bigbag
```

O subdiretório `produtos` guarda as fotos dos rótulos/EAN do conselheiro de saúde (introduzido depois do bootstrap inicial — criar se ainda não existir).

## 3. MySQL global — BD, user e GRANT restrito (🛑, mostrar SQL antes)

```sql
CREATE DATABASE IF NOT EXISTS app_bigbag
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'bigbag'@'localhost' IDENTIFIED BY '<no .env, não aqui>';
GRANT ALL PRIVILEGES ON app_bigbag.* TO 'bigbag'@'localhost';  -- só app_bigbag.*, nunca outras bases
FLUSH PRIVILEGES;
```

## 4. Migrações do schema (🛑 — DDL; mostrar SQL antes)

As migrações vivem em `backend/migrations/` e aplicam-se **todas, por ordem numérica** (`001` … `027`, e as que vierem a seguir). A `001` cria as tabelas-base (`loja`, `sku_normalizado`, `fatura`, `item`) de `docs/Schema_e_Funcoes_ToolUse.md`; as seguintes acrescentam colunas e tabelas de forma incremental (resumo abaixo). Como é DDL no MySQL do host, é paragem obrigatória: mostrar o SQL de cada uma antes de aplicar.

```sh
# como dev, na raiz da app, aplicar por ordem (idempotentes — usam IF NOT EXISTS onde dá):
for f in backend/migrations/*.sql; do
  echo ">> $f"
  mysql app_bigbag < "$f"     # credenciais via ~/.my.cnf ou variáveis de ambiente, nunca aqui
done
```

Mapa das migrações (até 027):

| # | O que acrescenta |
| --- | --- |
| 001 | Tabelas-base: `loja`, `sku_normalizado`, `fatura`, `item` |
| 002 | `loja.tipo` (supermercado/farmacia/outro) |
| 003–006 | Revisão de fatura, `sku_alias`, `fatura.numero`, `mensagem` (histórico) |
| 007–012 | `perfil`, `fatura.modelo`, `custo_chamada`, `origem_captura`, worklist de revisão, `nome_simplificado` |
| 013–018 | `item.linha_peso`, `item.ppb_inferido`, IVA por item, `sku_alias.confianca`, `produto_mestre`, `item.peso_em_falta` |
| 019 | `categoria_nutricao` (cache de nutrição por categoria, via Open Food Facts) |
| 020 | `produto_ean` (produto identificado por EAN + fotos) |
| 021 | `produto_foto` (fotos dos rótulos ligadas ao item) + `produto_ean.item_id` |
| 022 | `produto_analise` (cache da análise factual por EAN) |
| 023 | `produto_generico` (frescos por nome: fresco vs. processado + nutrição típica) |
| 024 | `produto_nome` (todos os nomes vistos para um EAN) |
| 025 | `nome_sugestao` (sugestões de nome canónico para o operador rever) |
| 026 | `perfil_membro` (perfil nutricional por membro do agregado) |
| 027 | `item.ean` (EAN-13 por linha de talão, quando o talão o imprime) |

**Sempre que se introduzem migrações novas, aplicá-las no deploy** (`git pull` traz os `.sql`; correr as que ainda não foram aplicadas, por ordem).

## 5. Backend + .env (não-🛑 na app; 🛑 só se mexer em serviço partilhado)

```sh
# como utilizador dev, na raiz da app:
git clone <repo> /home/dev/bigbag           # ou git pull --ff-only origin main
cd /home/dev/bigbag/backend
npm ci --omit=dev
cp .env.example .env && chmod 600 .env       # preencher valores reais
node src/server.js                           # arranque manual de teste → /health
```

## 5b. Frontend — build dos estáticos (não-🛑 na app)

O Apache serve `frontend/dist/`, logo é preciso construir o frontend (e **reconstruir a cada deploy** que mude o frontend). **Quando o `package.json` ganha dependências novas, correr `npm install` antes do build** — caso contrário a build falha por falta do módulo. Dependência relevante: **`@zxing/browser`** (scanner de código de barras), introduzida na linha do conselheiro de saúde.

```sh
cd /home/dev/bigbag/frontend
npm install            # (ou npm ci) — obrigatório quando há dependências novas no package.json
npm run build          # gera frontend/dist/, servido pelo Apache
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
- App exposta → **todas as rotas de aplicação exigem sessão autenticada** (`requireAuth`): faturas, consulta, voz, admin, explorar, produto, perfil. Só `/health` é público. `SUPERUSER_EMAIL` controla *quem* entra; o middleware impede chamadas *anónimas*. Duas camadas, ambas necessárias (Conceito §7).
- **Auth atual = portão temporário** `ENABLE_TEST_AUTH` (HTTP Basic) enquanto o Google OAuth aguarda o redirect URI na Google Console. Trocar pelo OAuth quando pronto.
- `OPENROUTER_TIMEOUT_MS=20000` herdado — vigiar com imagens de fatura grandes em VLM.

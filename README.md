# Repositório — Bigbag

App de histórico inteligente de preços de compras: lê faturas de supermercado, guarda os dados estruturados, e responde a consultas por nota de voz (estilo WhatsApp, resposta em texto). Projeto pessoal de laboratório, utilizador único.

---

## Repositório

| | |
| --- | --- |
| Nome | `Bigbag` |
| GitHub | `https://github.com/viberti/Bigbag` |
| Visibilidade | Privado |
| Branch principal | `main` |
| Remote | `origin` → `https://github.com/viberti/Bigbag.git` |

### Localização local
- **Máquina de desenvolvimento (Windows):** `C:\ProjetosAI\Bigbag`
- **Servidor de produção (Linux):** a definir no bootstrap — padrão do runbook `/home/<USUARIO>/<PROJ>` (ver runbook).

---

## Estrutura

```
Bigbag/
├── README.md          # este documento — informação do repositório (visível no GitHub)
├── CLAUDE.md          # regras de comportamento do Claude Code (raiz, lido automaticamente)
├── .gitignore         # exclui .env, node_modules, builds, logs, uploads
├── backend/           # API Node/Express (a crescer)
├── frontend/          # PWA React/Vite (a crescer)
└── docs/
    ├── Conceito_Historico_Precos_Voz.md   # conceito, arquitetura, decisões
    ├── Schema_e_Funcoes_ToolUse.md        # schema MySQL + contrato das funções de tool use
    └── Runbook_Bootstrap.md               # versão limpa (sem segredos) dos passos de servidor
```

O runbook com credenciais reais **nunca** entra no repositório; só a versão limpa em `docs/Runbook_Bootstrap.md`.

---

## Documentos e fontes de verdade

- **`CLAUDE.md`** — regras de trabalho do Claude Code (autonomia, paragens obrigatórias, testar antes de dar por feito, isolamento no servidor partilhado). Sem segredos; vai a commit.
- **`docs/Conceito_Historico_Precos_Voz.md`** — o porquê e o quê: conceito, dois subsistemas (ingestão de faturas, consulta por voz), arquitetura, decisões em aberto.
- **`docs/Schema_e_Funcoes_ToolUse.md`** — o como dos dados: schema MySQL e o contrato JSON das 4 funções de tool use.
- **Runbook de bootstrap** (fora do repo, versão com segredos é só local) — passos de servidor: utilizador, BD, systemd, Apache, HTTPS.

---

## Segredos — regra dura

- O `.env` (chaves OpenRouter, Google OAuth) **nunca** é versionado. Está no `.gitignore` desde o primeiro commit.
- Segredos vivem só em variáveis de ambiente no servidor (`backend/.env`, chmod 600).
- O runbook com valores reais fica apenas na máquina local; a versão que pode ir ao repo é a "limpa", sem credenciais.

---

## Fluxo de trabalho (git)

Padrão herdado do projeto 1417:

1. Trabalho num branch a partir de `main`.
2. Commits claros (em português).
3. `push` do branch → abrir Pull Request no GitHub.
4. Merge para `main` é decisão minha (não automático).
5. No servidor: `git pull --ff-only origin main` para atualizar produção.

`push` direto a `main` e reescrita de histórico são **paragens obrigatórias** definidas no `CLAUDE.md`.

---

## Próximos passos

1. Abrir o Claude Code apontado a `C:\ProjetosAI\Bigbag` — lê o `CLAUDE.md` e os docs.
2. Bootstrap da infraestrutura no servidor (runbook): utilizador, BD `app_bigbag`, systemd, Apache, HTTPS, smoke test.
3. Ingestão de faturas (Continente + Pingo Doce primeiro) — gerar ~30-50 faturas estruturadas.
4. Implementar e testar as 4 funções de consulta **em texto**.
5. Adicionar a camada de nota de voz.

### Decisões ainda em aberto (ver documento de conceito)
- Transcrição: STT separado vs. áudio-direto ao LLM.
- Leitura de fatura: VLM direto vs. OCR+LLM.
- ~~Autenticação~~ **fechada (2026-06-04):** servidor exposto à internet → Google OAuth + `SUPERUSER_EMAIL`.

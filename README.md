# Repositório — Bigbag

App de histórico inteligente de preços de compras **e conselheiro de saúde alimentar**: lê faturas de supermercado, guarda os dados estruturados, e responde a consultas por nota de voz (estilo WhatsApp, resposta em texto). Projeto pessoal de laboratório, utilizador único.

Versão atual do frontend (PWA): **v0.75.0**.

---

## Visão geral — o que o Bigbag faz hoje

O Bigbag começou como histórico de preços e cresceu para duas frentes complementares:

**Histórico de preços**
- **Ingestão de faturas:** envio por foto, digitalização, galeria em lote ou PDF multi-seleção; extração por VLM (imagem) ou texto-do-PDF+LLM, reconciliação honesta, normalização para preço por unidade-base (€/kg, €/L, €/un) e canonicalização de produtos.
- **Consulta por voz/texto:** funções de tool use sobre o histórico (última compra, comparação por loja, habituais, tendências de preço, total gasto, cadeia mais barata…).
- **Carrinho / lista de compras** habitual, agrupado por secção do mercado.
- **Despensa** (produtos em casa) e **análise de gastos**.
- **Redesign das compras** (vista de produtos por nota reformulada).

**Conselheiro de saúde alimentar**
- **Identificação de produto por EAN + fotos** dos rótulos (frente, ingredientes, validade): enriquece com Open Food Facts e com o que o VLM lê dos rótulos.
- **Scanner de código de barras** na app (via `@zxing/browser`) para consultar/identificar produto.
- **Ficha nutricional factual:** Nutri-Score, grupo NOVA e semáforo nutricional — informação factual, não clínica.
- **Frescos por nome:** caracterização genérica (fresco vs. processado) e nutrição típica por 100 g para fruta/legume/carne/peixe sem EAN.
- **Perfil nutricional personalizado** por membro do agregado, para avaliações alinhadas com objetivos/restrições de cada um.

Ver `docs/Conceito_Historico_Precos_Voz.md` e `docs/Visao_Conselheiro_Saude_Alimentar.md` para o detalhe.

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
    ├── Conceito_Historico_Precos_Voz.md       # conceito, arquitetura, decisões
    ├── Schema_e_Funcoes_ToolUse.md            # schema MySQL + contrato das funções de tool use
    ├── Normalizacao.md                        # normalização atual (problema, solução, lacunas)
    ├── Taxonomia_Produto.md                   # modelo-alvo facetado (Produto Mestre)
    ├── Visao_Conselheiro_Saude_Alimentar.md   # visão de saúde alimentar (nutrição, EAN, perfis)
    ├── Paper_Resolucao_Produtos_Talao.md      # relatório técnico do método de resolução de produtos
    └── Runbook_Bootstrap.md                   # versão limpa (sem segredos) dos passos de servidor
```

O runbook com credenciais reais **nunca** entra no repositório; só a versão limpa em `docs/Runbook_Bootstrap.md`.

---

## Documentos e fontes de verdade

- **`CLAUDE.md`** — regras de trabalho do Claude Code (autonomia, paragens obrigatórias, testar antes de dar por feito, isolamento no servidor partilhado). Sem segredos; vai a commit.
- **`docs/Conceito_Historico_Precos_Voz.md`** — o porquê e o quê: conceito, subsistemas (ingestão de faturas, consulta por voz), arquitetura, decisões em aberto.
- **`docs/Schema_e_Funcoes_ToolUse.md`** — o como dos dados: schema MySQL e o contrato JSON das funções de tool use.
- **`docs/Visao_Conselheiro_Saude_Alimentar.md`** — a visão para além do preço: nutrição herdada da classe via Open Food Facts, EAN/fotos, perfis nutricionais, princípio "factual não clínico".
- **`docs/Normalizacao.md` / `docs/Taxonomia_Produto.md`** — normalização atual e o modelo-alvo facetado (Produto Mestre).
- **Runbook de bootstrap** (`docs/Runbook_Bootstrap.md`, versão sem segredos) — passos de servidor: utilizador, BD, migrações, systemd, Apache, HTTPS.

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

## Estado

A infraestrutura está fechada (servidor, BD, systemd, Apache, HTTPS) e os três blocos principais funcionam: ingestão de faturas, consulta por texto/voz e o conselheiro de saúde alimentar (EAN/fotos, nutrição factual, perfis). O detalhe vivo do estado fica no `CLAUDE.md` (secção "Estado atual"); os passos de servidor no `docs/Runbook_Bootstrap.md`.

### Pendências em aberto
- **Auth:** ainda em **portão temporário** `ENABLE_TEST_AUTH` (HTTP Basic); o Google OAuth está configurado no `.env` mas a aguardar o redirect URI na Google Console.
- Revogar o sudo temporário de instalação no servidor.

### Decisões ainda em aberto (ver documento de conceito)
- Transcrição: STT separado vs. áudio-direto ao LLM (v1 em uso: áudio-direto).
- ~~Leitura de fatura: VLM direto vs. OCR+LLM~~ **fechada (2026-06-07):** VLM para imagem, texto-do-PDF+LLM para PDF.
- ~~Autenticação~~ **fechada (2026-06-04):** servidor exposto à internet → Google OAuth + `SUPERUSER_EMAIL`.

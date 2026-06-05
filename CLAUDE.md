# CLAUDE.md — Regras de trabalho neste projeto

Projeto pessoal de laboratório, **utilizador único**. PWA (React/Vite) + backend Node/Express + MySQL, no servidor de produção partilhado `85.25.46.6` (mesmo host de `pitacos.ai` e `1417`). App de histórico de preços de compras: lê faturas, guarda os dados, responde a consultas por nota de voz.

## Princípio geral
Trabalha com autonomia máxima. Decide sozinho tudo o que for **local e reversível** — estrutura de código, refactors, queries, migrações na BD do próprio projeto, escolha de bibliotecas, commits. Não peças permissão para isso. Pergunta o mínimo: quando algo for ambíguo e **reversível**, escolhe a opção razoável, segue em frente, e regista a suposição.

## Paragens obrigatórias (a ÚNICA lista de coisas a confirmar antes de executar)
Confirma comigo, mostrando o que vais correr, ANTES de:
1. Qualquer comando que toque em **serviços partilhados** do host — MySQL global, Apache, systemd, UFW, certbot — de forma que possa afetar `pitacos.ai` ou `1417`.
2. Qualquer **SQL de DDL/migração destrutiva** (DROP, TRUNCATE, ALTER que perca dados). Mostra o SQL antes. `GRANT` só em `app_<PROJ>.*`, nunca noutras bases.
3. **Apagar ou sobrescrever ficheiros** fora da árvore do projeto, ou ficheiros de dados/uploads já existentes.
4. **`git push`** para `main`, ou qualquer histórico reescrito (force-push, rebase de ramos partilhados).
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
- As 4 funções de tool use devem ser testáveis **por texto** antes de haver voz (ver ordem de construção).
- Frontend: a build passa (`npm run build`) e o fluxo principal funciona no browser.
- Se algo não dá para testar automaticamente, di-lo explicitamente e descreve como verificaste à mão.
- Não marques nada como "feito" com um teste a falhar ou por correr.

## Git
Decide o fluxo conforme o caso (commits pequenos e focados quando ajuda; agrupar quando faz sentido). Mensagens de commit claras e em português. `push` a `main` é paragem obrigatória (ver acima) — o merge é meu.

## Documentação — fontes de verdade
Mantém estes documentos atualizados **após cada alteração que mude o que neles está descrito** (não a cada commit trivial):
- **`Conceito_Historico_Precos_Voz.md`** — conceito, arquitetura, decisões. Atualizar quando uma decisão em aberto fechar ou a arquitetura mudar.
- **`Schema_e_Funcoes_ToolUse.md`** — schema da BD e contrato das funções. Atualizar sempre que o schema ou uma função mude.
- **Runbook de bootstrap** (versão limpa, sem segredos) — passos de servidor. Atualizar se o processo de deploy/infra mudar.
- Quando fechares uma "decisão em aberto" (transcrição, leitura de fatura, autenticação), regista a escolha e o porquê no documento de conceito.

## Estado atual (atualizar periodicamente — 2026-06-05)
- **Infra:** FECHADA. `https://bigbag.hal9klabs.com` público (Apache vhost + Let's Encrypt + redirect), `bigbag-backend.service` (systemd, enabled, auto-restart), BD `app_bigbag` + 4 tabelas + `loja.tipo` (migração 002).
- **Ingestão (Bloco 2):** a funcionar (VLM direto). Endpoint `POST /api/faturas` (atrás de auth) → extração → reconciliação (sinal honesto `discrepancia`) → BD. Lojas classificadas por `tipo` (supermercado/farmacia/outro).
- **Consulta (Bloco 3):** 4 funções + tool use implementadas e testadas (texto). Rota HTTP de consulta ainda por expor.
- **Auth:** OAuth configurado no `.env` mas a aguardar passo na Google Console (redirect URI). Entretanto, **portão temporário** `ENABLE_TEST_AUTH` (HTTP Basic, users `gustavo`/`sue`) protege as rotas expostas. Trocar pelo OAuth quando pronto.
- **Sudo temporário** `90-bigbag-nopasswd` ainda ativo (instalação não terminou).

## Decisões ainda em aberto (não inventar — usar a opção segura e assinalar)
1. **Transcrição de voz:** STT separado vs. áudio-direto ao LLM. Ambas via OpenRouter. Implementar de forma trocável; experimentar antes de fixar.
2. **Leitura de fatura:** VLM direto vs. OCR+LLM. VLM direto já em uso; OCR+LLM por implementar para comparar. `fatura.metodo_extracao` regista qual gerou cada registo.
3. ~~**Autenticação**~~ **FECHADA (2026-06-04):** servidor exposto à internet → Google OAuth + `SUPERUSER_EMAIL`. As rotas exigem sessão (portão temporário até o OAuth ficar ativo).

## Notas técnicas
- IA toda via **OpenRouter** (compatível OpenAI), uma só chave (`OPENROUTER_API_KEY`), cobre texto/imagem/áudio. Áudio vai em base64 (URLs não suportados para áudio).
- `OPENROUTER_TIMEOUT_MS=20000` herdado — vigiar; pode ser curto para imagem de fatura grande num VLM. Subir se necessário.
- Correspondência "produto em linguagem natural" → SKU canónico é trabalho do **backend** (fuzzy match / embeddings), não do prompt do LLM.
- Comparações de preço usam sempre `preco_por_base` (€/kg, €/L, €/un); filtrar `is_clearance` e `is_non_product`.
- PWA: testar câmara e microfone em **dispositivo real** (sobretudo iOS/Safari), não só no desktop.

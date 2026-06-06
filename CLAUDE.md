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
Mantém estes documentos atualizados **após cada alteração que mude o que neles está descrito** (não a cada commit trivial):
- **`Conceito_Historico_Precos_Voz.md`** — conceito, arquitetura, decisões. Atualizar quando uma decisão em aberto fechar ou a arquitetura mudar.
- **`Schema_e_Funcoes_ToolUse.md`** — schema da BD e contrato das funções. Atualizar sempre que o schema ou uma função mude.
- **Runbook de bootstrap** (versão limpa, sem segredos) — passos de servidor. Atualizar se o processo de deploy/infra mudar.
- Quando fechares uma "decisão em aberto" (transcrição, leitura de fatura, autenticação), regista a escolha e o porquê no documento de conceito.

## Estado atual (atualizar periodicamente — 2026-06-06)
- **Infra:** FECHADA. `https://bigbag.hal9klabs.com` público (Apache vhost + Let's Encrypt + redirect), `bigbag-backend.service` (systemd, enabled, auto-restart, porta 4200). BD `app_bigbag`, migrações aplicadas até **016** (013 `item.linha_peso`; 014 `item.ppb_inferido` — preço por base auto-corrigido; 015 `item.taxa_iva` + `fatura.precos_com_iva` — IVA por produto, com normalização do grossista para preço final; 016 `sku_alias.confianca` — score 0–100 do mapeamento descrição→SKU por via).
- **Três superfícies** (routing por path em `frontend/src/main.jsx`):
  - **App de chat (`/`)** — PWA do utilizador: envia notas (📷 → menu: digitalizar documento / foto / galeria em lote / arquivo-PDF multi-seleção), faz perguntas, e tem **carrinho de compras** (🔁 habituais → 🛒, agrupado por secção do mercado, swipe→ apaga, persistido em localStorage).
  - **Operador (`/admin`)** — desktop: gerir SKUs canónicos (renomear, associar/dissociar descrições, fundir, auto-merge de nomes idênticos), rever notas (imagem + itens, certo/errado + comentário), editar quantidade, ver qualidade por cadeia/origem, preencher `nome_simplificado`, e **aba Revisão** (worklist por confiança: itens sem SKU + mapeamentos de baixa confiança, do pior para o melhor).
  - **Comprador (`/explorar`)** — desktop, tema "talão": explorar produtos, preço pago vs por-unidade, variação (gráfico), por mercado, com seletor de mês/ano.
- **Ingestão (Bloco 2):** a funcionar. `POST /api/faturas` (auth): VLM direto p/ imagem, OCR-texto+LLM p/ PDF → extração → reconciliação (sinal honesto `discrepancia`; **desconto de cartão NÃO é espalhado** pelos itens — `preco_liquido` = preço impresso) → normalização (formato → `preco_por_base`) → canonicalização inline (LLM) + auto-merge de nomes idênticos. `origem_captura` regista o caminho de captura, para comparar leituras.
- **Consulta (Bloco 3):** **11 funções** + tool use, testadas (texto), expostas em `POST /api/consulta` (texto) e `POST /api/voz`. Funções: `buscar_ultima_compra`, `comparar_precos_por_loja`, `produtos_habituais`, `detalhes_fatura`, `produto_mais_barato`, `historico_preco`, `listar_compras`, `total_gasto`, `tendencia_precos` (produtos que subiram/desceram), `comparar_lojas` (cadeia mais barata p/ o usuário), `lembrar`. **Modelo de consulta = `gemini-2.5-flash` (full)** — o flash-lite era inconsistente em tool-use (ora chamava, ora devolvia vazio); a consulta é fração mínima do custo. Defensivas: normaliza prefixo do nome da tool (`default_api.*`) + guarda anti-resposta-vazia.
- **Auth:** OAuth configurado no `.env`, a aguardar redirect URI na Google Console. Entretanto, **portão temporário** `ENABLE_TEST_AUTH` (HTTP Basic, users `gustavo`/`sue`) protege as rotas. Trocar pelo OAuth quando pronto.
- **Sudo temporário** `90-bigbag-nopasswd` ainda ativo (instalação não terminou).
- **Backlog / pendências menores:** re-enviar #202/#203/#205 (preços impressos limpos); operador corrigir 3 ovos truncados do Lidl no `/admin`; lote da manhã (#86–93) com preços ligeiramente raspados (batem na mesma).

## Decisões ainda em aberto (não inventar — usar a opção segura e assinalar)
1. **Transcrição de voz:** STT separado vs. áudio-direto ao LLM. **v1 em uso:** áudio-direto via chat (`input_audio` base64), de forma trocável em `transcricao.js`. Falta experimentar STT-separado antes de fixar.
2. **Leitura de fatura:** VLM direto vs. OCR+LLM. **Ambos em uso, por tipo de ficheiro:** VLM p/ imagem, OCR-texto+LLM p/ PDF; `fatura.metodo_extracao` regista qual gerou cada registo. **Head-to-head feito (2026-06-06)** — `backend/scripts/compara_extracao.mjs` corre os dois sobre o mesmo PDF: em 16 PDFs Continente, **OCR+LLM (texto) ≥ VLM**: reconciliam 16/16 vs 15/16, |disc| média 0,000 vs 0,054 (o VLM divide mal itens multilinha, ex. #211/#87). **Recomendação: manter OCR+LLM para PDF, VLM para imagem** (fotos não têm texto a extrair — fora deste teste). Falta a confirmação por veredicto de operador (reconciliar ≠ ler certo) para fechar formalmente.
3. ~~**Autenticação**~~ **FECHADA (2026-06-04):** servidor exposto à internet → Google OAuth + `SUPERUSER_EMAIL`. As rotas exigem sessão (portão temporário até o OAuth ficar ativo).

## Internacionalização (i18n) — base PT-BR, código localizável
- **Idioma base: português do Brasil (PT-BR)**, tratando o usuário por "você". Mas **nunca hardcodar texto visível** ao usuário — codificar de forma a permitir tradução fácil.
- **Frontend:** todo o texto da UI passa por `frontend/src/i18n.js` via `t('chave', vars)` (interpolação `{var}`, plural `{n|sing|plur}`, deteção do idioma do browser). **Traduzir = adicionar um dicionário** de idioma; os componentes não mudam.
- **Backend (respostas do assistente):** o idioma está centralizado no system prompt (`consulta.js`); pode passar a locale-driven quando houver 2.º idioma.
- **Exceções (não são UI, ficam como dados):** prompts internos de extração de nota e os nomes de produtos canónicos (vêm de notas de supermercados de Portugal).

## Notas técnicas
- IA toda via **OpenRouter** (compatível OpenAI), uma só chave (`OPENROUTER_API_KEY`), cobre texto/imagem/áudio. Áudio vai em base64 (URLs não suportados para áudio).
- `OPENROUTER_TIMEOUT_MS=20000` herdado — vigiar; pode ser curto para imagem de fatura grande num VLM. Subir se necessário.
- Correspondência "produto em linguagem natural" → SKU canónico é trabalho do **backend** (fuzzy match / embeddings), não do prompt do LLM.
- Comparações de preço usam sempre `preco_por_base` (€/kg, €/L, €/un); filtrar `is_clearance` e `is_non_product`.
- PWA: testar câmara e microfone em **dispositivo real** (sobretudo iOS/Safari), não só no desktop.

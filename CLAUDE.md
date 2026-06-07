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
- **`Normalizacao.md`** — normalização **atual** (problema, dificuldades, solução, lacunas). Atualizar quando a normalização mudar.
- **`Taxonomia_Produto.md`** — modelo-alvo **facetado** (standards OFF/GS1/IFPS, níveis, coorte, Produto Mestre). Atualizar quando uma decisão de desenho fechar; é o norte da migração incremental.
- **Runbook de bootstrap** (versão limpa, sem segredos) — passos de servidor. Atualizar se o processo de deploy/infra mudar.
- Quando fechares uma "decisão em aberto" (transcrição, leitura de fatura, autenticação), regista a escolha e o porquê no documento de conceito.

## Estado atual (atualizar periodicamente — 2026-06-06)
- **Infra:** FECHADA. `https://bigbag.hal9klabs.com` público (Apache vhost + Let's Encrypt + redirect), `bigbag-backend.service` (systemd, enabled, auto-restart, porta 4200). BD `app_bigbag`, migrações aplicadas até **018** (013 `item.linha_peso`; 014 `item.ppb_inferido` — preço por base auto-corrigido; 015 `item.taxa_iva` + `fatura.precos_com_iva` — IVA por produto, com normalização do grossista para preço final; 016 `sku_alias.confianca` — score 0–100 do mapeamento descrição→SKU por via; 017 `produto_mestre` + `sku_normalizado.mestre_id` — modelo facetado; 018 `item.peso_em_falta` — produto a peso sem peso na nota, fora do €/kg honesto).
- **Três superfícies** (routing por path em `frontend/src/main.jsx`):
  - **App de chat (`/`)** — PWA do utilizador: envia notas (📷 → menu: digitalizar documento / foto / galeria em lote / arquivo-PDF multi-seleção), faz perguntas, e tem **carrinho de compras** (🔁 habituais → 🛒, agrupado por secção do mercado, swipe→ apaga, persistido em localStorage).
  - **Operador (`/admin`)** — desktop: gerir SKUs canónicos (renomear, associar/dissociar descrições, fundir, auto-merge de nomes idênticos), rever notas (imagem + itens, certo/errado + comentário), editar quantidade, ver qualidade por cadeia/origem, preencher `nome_simplificado`, **aba Revisão** (worklist por confiança: itens sem SKU + mapeamentos de baixa confiança, do pior para o melhor), e **aba Ligar nomes** (busca a descrição do talão dos dois lados → liga/desliga a um produto canónico; inverso do fluxo da aba Produtos).
  - **Comprador (`/explorar`)** — desktop, tema "talão": explorar produtos, preço pago vs por-unidade, variação (gráfico), por mercado, com seletor de mês/ano.
- **Ingestão (Bloco 2):** a funcionar. `POST /api/faturas` (auth): VLM direto p/ imagem, OCR-texto+LLM p/ PDF → extração → reconciliação (sinal honesto `discrepancia`; **desconto de cartão NÃO é espalhado** pelos itens — `preco_liquido` = preço impresso) → normalização (formato → `preco_por_base`) → canonicalização inline (LLM) + auto-merge de nomes idênticos. `origem_captura` regista o caminho de captura, para comparar leituras.
- **Consulta (Bloco 3):** **11 funções** + tool use, testadas (texto), expostas em `POST /api/consulta` (texto) e `POST /api/voz`. Funções: `buscar_ultima_compra`, `comparar_precos_por_loja`, `produtos_habituais`, `detalhes_fatura`, `produto_mais_barato`, `historico_preco`, `listar_compras`, `total_gasto`, `tendencia_precos` (produtos que subiram/desceram), `comparar_lojas` (cadeia mais barata p/ o usuário), `lembrar`. **Modelo de consulta = `gemini-2.5-flash` (full)** — o flash-lite era inconsistente em tool-use (ora chamava, ora devolvia vazio); a consulta é fração mínima do custo. Defensivas: normaliza prefixo do nome da tool (`default_api.*`) + guarda anti-resposta-vazia.
- **Auth:** OAuth configurado no `.env`, a aguardar redirect URI na Google Console. Entretanto, **portão temporário** `ENABLE_TEST_AUTH` (HTTP Basic, users `gustavo`/`sue`) protege as rotas. Trocar pelo OAuth quando pronto.
- **Sudo temporário** `90-bigbag-nopasswd` ainda ativo (instalação não terminou).
- **Extração estruturada de peso (2026-06-07):** o esquema do VLM passou a ter **`peso_kg` + `preco_base_impresso`** (€/kg) em campos PRÓPRIOS; `descricao_original` = só o nome. `normalizarItens` reconstrói o `linha_peso` canónico desses campos (autoritativo, sem regex) → o €/kg vem direto do talão na origem (recupera a causa 2 da lacuna). Validado por re-extração real (Lidl #35: BANANA peso_kg=1.134/€1.19, ALPERCE 0.362/€4.99…). Regex no `normalizarItens` fica como rede de segurança (PDF-texto/retrocompat).
- **Limpeza de descrições (2026-06-07):** o nome capturado já NÃO carrega qtd/peso/preço/IVA. `normalize.normalizarItens` corre `limparDescricao` como passo final (preserva o peso em `linha_peso` antes de o tirar — o `reprocess` calcula ppb de `descricao_original`+`linha_peso`). `matcher.resolverSku` passou a usar a **descrição limpa como chave de alias** (antes a chave crua tinha o peso variável → a mesma banana nunca reusava o alias). Backfill aplicado (`scripts/limpar_descricoes.mjs`, idempotente): 157 descrições de `item` limpas, 148 `sku_alias` fundidos (632→488), mamão (#2300) dissociado da Banana. Ex.: Banana 8 descrições→4, com as 14 compras consolidadas em "BANANA".
- **Deduplicação robusta (2026-06-07):** a dedup antiga (scoped a `loja_id`, por nº-doc OU data+total) falhava quando o VLM lia mal o **nome da loja** (Mercadona→"Irmadona" → loja_id diferente) ou a **data**. Adicionada rede 2 em `persist.js`: **cadeia + total + nº de itens**, confirmada por **sobreposição de preços** (`sobreposicaoPrecos`, tolera ±0,02 de OCR). Corrigido o estrago: loja "Irmadona" #17 fundida no Mercadona; **3 faturas duplicadas apagadas** (#197/#192/#239); €/kg recuperável re-extraído (só 1 item — o resto é causa 1).
- **Itens a peso sem peso na nota (2026-06-07):** migração **018** `item.peso_em_falta`. Quando o produto é a peso (unidade kg/L) mas a nota não traz peso, `ppb=NULL` (incomputável honesto, já era) + `peso_em_falta=1` (marca o porquê) → fora do €/kg sem fingir um €/peça enganador. `decidirUnidadeBase`: "partido/partida/metade/granel" → kg (peça cortada a peso, ex.: mamão partido). Mamão (#609) corrigido un→kg. **193/593 itens** marcados. Caso validado pela própria imagem da nota #198 (mamão sem linha de peso; banana/batata com).
- **⚠ Lacuna de €/kg (investigada 2026-06-07):** **216/626 itens (34,5%) sem `preco_por_base`** — kg 60%, L 53%, un só 4%. **Re-extração testada (causa 2): só 1 item recuperável** — o resto é **causa 1** (a loja não imprime €/kg: Mercadona/Aldi dão só o preço da peça). Resolvido honestamente com `peso_em_falta` (acima). **Derivação por pacote fixo (2026-06-07):** quando o produto é a peso mas a linha não traz peso E o SKU é um **pacote fixo fiável** (`formato_valor` real ≠1, nunca pesado ao balcão, sem marcador KG/GRANEL nem multipack na descrição), o `ppb` deriva-se de `preço / tamanho do pacote` (`ppb.js` `pacoteFixoFiavel`). Recupera ex.: **mirtilo 500g→10,30€/kg**, salada, café descafeinado, passata, kefir, lixívia (8 itens). NÃO deriva p/ itens pesados (banana/carne) nem `formato_valor=1` default → evita €/kg fabricado.
- **Backlog / pendências menores:** re-enviar #202/#203/#205 (preços impressos limpos); operador corrigir 3 ovos truncados do Lidl no `/admin`; lote da manhã (#86–93) com preços ligeiramente raspados (batem na mesma).

## Decisões ainda em aberto (não inventar — usar a opção segura e assinalar)
1. **Transcrição de voz:** STT separado vs. áudio-direto ao LLM. **v1 em uso:** áudio-direto via chat (`input_audio` base64), de forma trocável em `transcricao.js`. Falta experimentar STT-separado antes de fixar.
2. ~~**Leitura de fatura:** VLM direto vs. OCR+LLM.~~ **FECHADA (2026-06-07).** Por tipo de ficheiro: **VLM p/ imagem (foto/scan), texto-do-PDF+LLM p/ PDF**; `fatura.metodo_extracao` regista qual gerou cada registo (`ocr_llm` é, na verdade, "texto-do-PDF+LLM" — não há OCR real). Dois head-to-heads: **(a) PDF** (`compara_extracao.mjs`, 16 PDFs) → texto+LLM ≥ VLM (reconciliam 16/16 vs 15/16, |disc| 0,000 vs 0,054); **(b) FOTO** (10 fotos) → VLM-direto ≫ Tesseract→LLM (reconciliam **9/10 vs 3/10**, total certo 10/10 vs 6/10, |disc| 0,011 vs 1,919 — OCR de foto leva o LLM a **alucinar** talão a partir de ruído). **Custo é neutro entre modalidades** (medido via `usage.cost`/`custo_chamada`): só o modelo pesa (flash ~5× lite), não imagem-vs-texto. OCR dedicado p/ fotos **rejeitado**. Ver `docs/Conceito_Historico_Precos_Voz.md` §4.
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

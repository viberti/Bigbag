# Revisão das técnicas de classificação e normalização — 2026-06-12

> Revisão multi-agente (12 agentes de análise + 12 verificadores adversariais, ~1,7M tokens) sobre o código real + métricas da BD de produção. Cada achado foi atacado por um verificador com 3 lentes: a evidência sustenta? viola princípios da casa (determinístico-primeiro, LLM-só-insubstituível-e-cacheado, embeddings-só-Fase-C, operador-é-juiz)? é proporcional a um lab de 1 pessoa? Os achados **rejeitados** estão listados no fim — a transparência é parte do método.

## Veredicto geral

**As técnicas estão sólidas e os números provam-no**: 651 itens comprados → **0,2% sem SKU** (1 item); 325 SKUs → **2 em 'outros'** (99,4% classificados); 460 aliases todos ≥0,8; reconciliação como métrica embutida. A cascata de classificação (OFF food_groups → exceções cirúrgicas → substantivo-cabeça → categoria de loja), o token-matching com IDF + facetas-como-gates, a marca determinística pré-LLM e a verificação voto-a-3 são desenho maduro.

**O que falta não é técnica nova — é (1) REDE DE MEDIÇÃO para mexer com segurança, e (2) CONSOLIDAÇÃO do que está duplicado/disperso.** O adiamento de embeddings para a Fase C foi explicitamente confirmado pela revisão ("decisão correta, sintomas de reabrir bem definidos": taxa de não-resolvidos a subir, fuzzy+sinónimos esgotados).

## Prioridade 1 — a rede de segurança (fazer primeiro)

### 1.1 Golden set de regressão para a classificação ⭐ (médio esforço, alto impacto)
Hoje `categoria.test.mjs` tem ~10 testes (casos pontuais de bugs passados) contra um vocabulário de ~190 termos, 11 grupos e uma cadeia de precedências. As mudanças de vocabulário de 2026-06-12 (massa→mercearia, +18 formatos de massa, "pasta" removido) correram sem rede além desses 10 testes.
**Fazer:** gerar ~300 casos-ouro da BD real (`nome → grupo` auditado; matéria-prima: os 325 SKUs com grupo + 460 aliases validados + 17 pares matchEan aprovados — "dados de treino desperdiçados" hoje), guardar em `backend/test/fixtures/golden_grupos.json`, e um teste que corre o classificador contra ele e mostra o **DIFF** a cada mudança. Mudança intencional = atualizar o golden no mesmo commit (o diff é a documentação).

### 1.2 Painel de qualidade não mede classificação (baixo, alto)
A aba Qualidade do `/admin` não tem métricas de grupo. **Fazer:** taxa de 'outros', SKUs sem grupo, itens sem SKU, e os nomes NOVOS vindos do scan (que hoje não passam por auditoria nenhuma — ver 3.4).

### 1.3 ~~Saturação da confiança do alias~~ — ALARME FALSO (corrigido 2026-06-13)
A investigação mostrou que a alegação original estava **errada por erro de escala na query da própria revisão** (`>=0.8` numa coluna 0–100 → tudo "≥0.8"). A realidade: a confiança do alias **é um código de VIA, não probabilidade** (migração 016): 100=manual ×112 · 90=match ×23 · 75=juiz ×6 · 60=SKU-novo ×319. O LLM da canonicalização usa 0–1 e compara com 0.6 na mesma escala — **sem bug**. A worklist usa limiar 70 (escala certa) e funciona.
**O achado real que sobra:** a confiança **nunca sobe com o uso** — um alias via-novo usado em N talões sem correção fica 60 para sempre; a worklist tem 319 entradas permanentes que o operador nunca esvazia. Promover com o uso (ex.: ≥3 talões sem correção → 75) é **mudança de semântica da migração 016 → decisão do dono pendente**.

## Prioridade 2 — consolidação (eliminar duplicação que vai divergir)

### 2.1 Vocabulários front/back unificados ⭐ (médio, alto)
`TIPOS_NOME`/`tipoConsumidor`/`GEN_RE` (frontend App.jsx) e `GRUPOS`/`grupoDeNome` (backend categoria.js) são vocabulários PARALELOS mantidos à mão em conjunto (caso real: "cotovelos" adicionado nos dois no mesmo dia; e2e usou réplicas inline = 3+ cópias). Junta-se o achado da revisão geral: **`norm()` redefinida em 7+ ficheiros com 2 variantes incompatíveis**.
**Fazer:** módulo partilhado de classificação+normalização de texto importável pelos dois lados (o caminho existe — `backend/test/listaOutbox.test.mjs` já importa de `frontend/src/`). Candidatos: `norm`, `singularizar`, `tokenCasa`, `chaveItemLista`, vocabulários de grupo/tipo, `GEN_RE`, `limparTamanho`.

### 2.2 Limpar a coluna `marca` do catálogo (baixo, médio)
O gazetteer de marcas herda lixo: `#ref!` ×442, compostos "Arrighi, Pasta Berruto". **Fazer:** audit + `UPDATE ... SET marca=NULL` para o lixo, e separar compostos óbvios. O código (marca.js) está bem protegido — o problema é só o dado.

### 2.3 `skusDoNome` vs `matchProduto` (baixo, médio)
A lógica fortes/fracos por substantivo-cabeça existe duplicada (lista vs consulta) — já estava no backlog ("unificar fortes/fracos"); a revisão confirma.

### 2.4 Política de fusão por campo — documentar, não refactorizar (ajustado pelo verificador)
A prioridade por campo (nome: catálogo-PT>OFF; nutrição: OFF>catálogo>VLM; marca: ficha>deteção; peso: ficha→catálogo→nome→imagem) está espalhada por 5 módulos. O verificador REJEITOU o refactor para tabela declarativa (cerimónia); **fazer só:** comentário-cabeçalho padronizado em cada módulo ("Política de fusão deste módulo: campo→prioridade") + secção única no CLAUDE.md. Idem para os 3 mecanismos de tentado-uma-vez (documentar as diferenças intencionais, não unificar).

## Prioridade 3 — enriquecimento das técnicas (quando a rede existir)

### 3.1 Minerar `categoria_path` das lojas → grupo (médio, alto)
19k Continente + 12k Auchan têm hierarquia de loja explícita ("Mercearia/Massa", "alimentacao/mercearia/arroz-e-massa") que NÃO entra na classificação (só a `categoria` texto-livre). **Fazer:** script 1× que constrói o mapa {loja→2.º nível do path→grupo}, validado por amostra (20/loja), consultado em `grupoDe()` antes do texto-livre. Cobre dezenas de milhares de produtos de scan futuros sem vocabulário manual.

### 3.2 Mineração de sinónimos dos pares mesmo-EAN (médio, médio)
Auchan×Continente partilham EANs = ground truth GRÁTIS de variação de nomes do mesmo produto ("Massa Barilla Penne Rigate 500g" vs "Massa Penne Rigate Barilla"). **Fazer:** minerar os pares para extrair regras de variação (ordem, posição da marca, genéricos) e dicionário de sinónimos (esparguete↔spaghetti) para o matcher entre lojas. (Proposta nascida na conversa de 2026-06-12, validada tecnicamente pela revisão.)

### 3.3 Fuzzy edit-distance — MEDIR primeiro (ajustado)
O token-matching é igualdade exata: "Concchiglioni" (typo real do OFF) nunca casaria "Conchiglioni" — hoje salvou-o a marca. **Fazer na ordem certa:** script que MEDE a taxa de typos não-capturados no catálogo (padrões cc-duplo, transposição, em tokens de IDF alto); só implementar edit-distance 1–2 em `pontuarBusca` se a taxa justificar.

### 3.4 Auditoria do fluxo de scan (ajustado para mensal)
Produtos que entram por scan (nunca comprados) não passam por auditoria de classificação nenhuma. **Fazer:** registar sempre a origem da classificação; mensalmente, auditar os nomes novos do mês + 10–15 SKUs já auditados (deteta drift) com o LLM-juiz calibrado por canários.

### 3.5 Vocabulário em BD com operador-é-juiz (médio, médio — opcional)
Tabela `vocabulario_grupo` editável no `/admin` (termo→grupo, com fonte e validação) em vez de editar código. Alinhado com operador-é-juiz; com a escala atual, código+golden set pode bastar — decidir quando o whack-a-mole de termos incomodar. O LLM-batch entra aqui só como **enriquecedor mensal dos 'outros'** (operador aprova), nunca como substituto.

### 3.6 Plausibilidade para a nutrição (baixo, médio)
O peso tem guarda (5g–15kg); a nutrição lida por VLM não tem nenhuma. **Fazer:** gates simples (kcal≤900/100g, macros≤100g/100g, soma coerente) antes de gravar nutrição só-VLM.

### 3.7 Miudezas aceites
GEN_RE precisa de testes de casos-limite ("Massa de Pizza", "Conserva de Atum"); allowlist de marcas curtas reais ("Bom", "UHU") no detetor; prompt da canonicalização: 1 frase sobre conectores ("com/sem/para" são facetas); logging de erros OFF (rate-limit só se houver incidente).

## O que a revisão CONFIRMOU como está (não mexer)

- **`produto_mestre` 92% singletons NÃO é bug**: é a chave estrita de 10 slots a funcionar como desenhado, à escala de 325 SKUs. Relaxar slots agora = fusões erradas. Reavaliar quando houver mais dados (e DEPOIS do golden set).
- **first-match-ganha** na ordem dos grupos: intencional, testado, documentado.
- **Embeddings ficam na Fase C**: sintomas para reabrir = taxa de não-resolvidos a subir com fuzzy+sinónimos já esgotados.
- **eanSuspeito/ADJACENTES**: sólida; falsos negativos em nomes opacos são limite conhecido e aceite.
- **Robustez de plurais/acentos/marca-palavra** (milk_): testada.

## Rejeitados pelo verificador (transparência)

- "OFF food_groups é ignorado na classificação" — **FALSO**: `enriquecer.js` passa `foodGroups` a `grupoDe()`, que os processa primeiro. (Alegação técnica errada.)
- "unidadeVenda frágil, estender a rolos/pilhas" — impacto real ~0,3%, extensões eram conjeturas.
- "Colisões em chaveItemLista" — risco medido: 0 no domínio.
- "Ciclo do verificador de nomes está aberto" — já realimenta (corrige E re-resolve o SKU).
- "Guarda de marca por prefixo GS1" (proposta do doc de exploração) — **despriorizada**: sinal secundário com 56% de cobertura e 3 fragilidades de desenho; fica anotada, não se constrói já.
- (Da revisão geral: staging completo, auditoria de servidor, sync-checker de docs — cerimónia desproporcional.)

## Estado de execução (2026-06-13)
- **1.1 Golden set — FEITO** (`test/fixtures/golden_grupos.json` 325+92, `golden_grupos.test.mjs`, gerador `scripts/gerar_golden_grupos.mjs`, gate no `deploy.sh`, convenção `*.bd.test.mjs`). **Já rendeu antes de existir:** apanhou drift real — a mudança massa/arroz/farinha→mercearia (2026-06-12) tinha ficado só no código; o `sku.grupo` da BD estava na taxonomia antiga → re-backfill (padaria 39→26, mercearia 29→43).
- **1.2 Painel — FEITO** (bloco Classificação na aba Qualidade: grupos, sem-SKU, aliases por via, scan-sem-grupo). Primeiro uso denunciou lixo na métrica (corrigido) e a worklist informal viva (10/26 nomes de scan sem grupo pelo nome; nota: "Pães" não classifica — o termRe não singulariza tokens).
- **1.3 — INVESTIGADO** (alarme falso; ver secção corrigida acima; decisão "promover confiança com uso" pendente do dono).

## Ordem sugerida de execução

1. **Golden set + métricas no painel** (1.1, 1.2) — a rede que permite tudo o resto.
2. **Unificação front/back + norm()** (2.1) — estanca a divergência antes que ela cresça.
3. **Limpeza da marca + alias-saturação** (2.2, 1.3) — dados saudáveis.
4. **categoria_path mining** (3.1) — o maior salto de cobertura por euro.
5. O resto conforme a dor aparecer (3.2, 3.3 medido, 3.4 mensal).

---
*Da revisão de metodologia geral (relatório irmão, mesma data): as 3 ações operacionais de topo são backup automático da BD (mysqldump diário), procedimento de rollback documentado, e git tags por release — nenhuma é de classificação/normalização mas o backup protege exatamente os dados que estas técnicas produzem.*

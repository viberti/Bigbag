# Exploração — Marca, Fontes e Resolução de Entidades (caso Barilla Penne)

> Sessão de exploração de 2026-06-12, a partir do caso real **Barilla Penne Rigate, EAN `8076802085738`** (scaneado para a lista). Não foi construído nada destas ideias — é um caderno de **conclusões + propostas** para retomar. O que JÁ foi implementado nesta sessão (nome PT do catálogo a ganhar ao OFF, auto-cura, categoria de massas) está no CLAUDE.md, não aqui.

## 1. O que aprendemos (conclusões dos dados reais)

### Identidade ≠ EAN
- O **mesmo EAN** aparece em várias fontes, muitas vezes em línguas diferentes: `8076802085738` = "Massa Penne Rigate Barilla" (Continente), "Massa Barilla Penne Rigate 500g" (Auchan), "Penne Rigate No. 73 Durum Wheat Semolina Pasta" (OFF, inglês), "Penne Rigate Blue Box" (catálogo oficial Barilla).
- Um produto popular tem **muitos EANs** (packs/países). O EAN é identidade de *pack*, não de *produto*. A identidade estável é **`marca + forma/variante`** (Barilla + penne rigate). O resto é ruído removível: genérico (massa/pasta/semola), tamanho, marketing (No. 73), língua.
- **Aberto:** o MESMO produto com **EANs diferentes** (variantes/países) ainda resolve independente — é o problema do Produto Mestre / resolução de entidades.

### A ponte por nome alcança fontes sem EAN
- Continente e Auchan **partilham o EAN**; Pingo Doce e Lidl-PT **não têm EAN** (só o nome os liga). A resolução por nome não é "nice-to-have": é a **única** ponte para ~15k produtos Pingo Doce + 390 Lidl.
- Matcher validado (marca + conjunto de tokens-conteúdo, ignorando genéricos/tamanho/marca): Penne Rigate e Fusilli → 3 lojas, **sem falsos positivos** (não puxa *pennette*, *rigatoni* nem outras marcas). Lacuna: sinónimos (esparguete↔spaghetti) e variância da coluna marca.

### Fontes são especialistas complementares — escolher por CAMPO
| Fonte | Melhor em… | Fraca em… |
|---|---|---|
| **Catálogo de loja** (Continente/Auchan/…) | nome PT, ingredientes+alergénios, nutrição, categoria PT | índices de saúde; presa à loja |
| **OFF** | Nutri-Score, NOVA, grupo alimentar; cobertura ampla de EANs | língua, nutrição irregular, crowdsourced |
| **Talões** | **preço-facto** + o que ESTA casa compra | só o que já se comprou |
| **Catálogo de marca** (Barilla…) | **linha/posicionamento canónico** de marcas grandes; família de EANs | por-marca, frágil, país-específico, dados de *trade* |

- Para a Penne, a melhor ficha factual veio do **Auchan** (nome PT, ingredientes c/ alergénios, nutrição), não do OFF. O OFF só acrescentou Nutri-Score A / NOVA 1 / grupo.
- **Princípio:** não se procura *a* fonte certa — agrega-se e escolhe-se **por campo**, cada fonte onde é mais forte. Adicionar uma fonte só vale se for *a melhor* nalgum campo que importa. Preço **nunca** entra (só talões).

### A marca é o sinal estrutural mais forte e barato
- Cobertura **93%** (57.545/61.753); grafia **estável** ("Barilla" idêntico nas 3 lojas); 4.727 marcas distintas.
- **Bimodal:** marca **nacional** (Barilla, Mimosa em 4 fontes, Margão) = ponte entre lojas, comparável; marca-**própria** (Continente, Hacendado, Auchan, Pingo Doce, Cien/Deliplus do Lidl) = presa a uma loja → só *equivalentes por forma*.
- **A marca codifica posicionamento/qualidade** (de graça, determinístico):
  - Marca-própria → sub-marcas: *Seleção/Iguarias/Collection* (premium), *Equilíbrio* (saúde), *Bio* (orgânico), *Cozinha* (refeição pronta), base (valor).
  - Marca nacional → linhas próprias: Barilla *Blue Box* (base) · *Integrale* · *La Collezione* (premium) · *Sem Glúten* · *Piccolini* (infantil).
- O **escalão de marca** é um atalho de "qualidade percebida" muito mais barato e estável que reviews por-produto.
- **Lixo a limpar:** `#REF!` (`#ref!`) vazou para a coluna marca em **442 linhas** (erro de folha de cálculo).

### Catálogo oficial da marca (Barilla) — o que é
- `barilla-tv.webflow.io/catalogo/colecoes`: catálogo de **trade (B2B)**, **PT-BR** (Barilla Brasil). Fichas ricas em **logística** (12×500g, validade 1.920d, NCM, paletização) — inútil para o consumidor.
- Confirma a identidade (EAN `8076802085738` = Penne Rigate Blue Box) e dá a **estrutura de linha** da marca. É a única coisa que acrescenta ao consumidor. Frágil (microsite Webflow), país-específico.

### Reviews / "é um bom produto?"
- "Bom" parte-se: **factual/absoluto** (Nutri-Score/NOVA/ficha — para a Penne: massa limpa, boa) vs **bom para quem** (perfil; glúten ⇒ mau para celíaco).
- Reviews só ganham sinal nos **processados** (num básico são ruído: "boa massa, 5★"); mesma fronteira do veredicto-por-produto.

### Marca errada vinda do OFF — guarda por prefixo GS1 (PROBLEMA ANOTADO 2026-06-12)
- Caso real: EAN `8000270013801` (Cannelloni) vinha do OFF (live, crowdsourcing) como marca **Buitoni**; é **Delverde** (marcas de grupos diferentes — não relacionadas). Corrigido à mão (`produto_ean.marca='Delverde'`). A marca importa (exprime gosto pessoal), por isso vale resolver.
- **O prefixo GS1 identifica o FABRICANTE, não a marca de consumo.** No nosso catálogo: prefixo-7 `8000270` = Delverde ×11 (+3 Bimbo, prováveis erros nossos). Prefixo→marca é **limpo em ~56%** (1047/1886); 44% ambíguos — porque **retalhistas usam 1 prefixo para dezenas de marcas próprias** (Lidl `4056489`→Cien/Alesto/Deluxe…; Continente `5601312`→50+; Mercadona `8480000`→Hacendado+).
- **Proposta:** guarda de marca por prefixo — do catálogo (marca fiável) mapear prefixo→marca DOMINANTE; quando o OFF é a única fonte e dá uma marca que contradiz um prefixo claramente de-uma-marca, desconfiar do OFF. Funciona p/ **marcas independentes** (Delverde/Barilla/Rummo), ignora prefixos ambíguos (retalho) sem risco. Construir como **correção em lote REVISTA** (gera "que mudaria e porquê" → revisão → aplica), não às cegas na ingestão. Heurística (prefixo-7 fixo, limiar de dominância) — validar antes de confiar.

### Peso em falta → ler da IMAGEM do catálogo pelo VLM (ACHADO 2026-06-12)
- Muitos produtos **Continente/Pingo Doce** ficam com `formato="1un"` (sem peso) porque **o peso não está no TÍTULO** — está num atributo/na imagem. (O Auchan mete o peso no título, daí ter peso.) A página é JS+anti-bot (WebFetch só vê o menu), MAS a **`imagem_url` é pública** (CDN).
- Prova: Tagliatelle Rummo (EAN 8008343201070), Continente `1un` → fetch da `imagem_url` → `extrairProdutoFotos` (VLM) leu **"500 g"** → gravado. Correu na lista.
- **Escala:** **29.748** produtos com imagem mas sem peso ("Nun"): Continente 18.630 · Pingo Doce 8.534 · Auchan 2.195 · Lidl 389. Custo VLM ~\$0,001/imagem.
- **Proposta:** ferramenta "peso pela imagem" — (a) **on-demand/lazy**: quando a lista precisa do peso e o catálogo tem imagem mas não formato, o VLM lê a imagem 1x e **grava no catálogo** (self-healing, só paga os produtos usados, sem latência na lista — correr em fundo); (b) **lote**: enriquecer os 29,7k de uma vez (~\$30). Começar pela (a).

## 2. Propostas em aberto (minhas sugestões durante a exploração — para retomar)

1. **Priorizar o catálogo de loja na ficha factual** (ingredientes/categoria/nutrição), em vez de buscar fontes novas. Detetadas 2 fugas na própria Penne: `produto_ean.categoria` em inglês ("Dry durum wheat pasta…") quando o Auchan tem `mercearia/arroz-e-massa/massas-especialidades`; ingredientes na versão curta quando o Auchan tem a completa com alergénios. Determinístico, sem scraping novo.
2. **Matcher de identidade entre lojas por nome** (marca + conjunto de tokens-conteúdo) — ligar o mesmo produto entre lojas, incl. sem-EAN (Pingo Doce/Lidl). Resolver lacuna de sinónimos (esparguete↔spaghetti). Base do Produto Mestre alimentado por nome.
3. **Escalão de marca** — mapear sub-marcas próprias (Seleção/Bio/Equilíbrio/…) e linhas de marca nacional (Blue Box/Integrale/…) para tiers (premium/saúde/bio/valor/base) e usar como sinal de posicionamento na ficha. O "atalho de qualidade" determinístico.
4. **Nacional vs própria** — marcar cada marca como nacional/própria(loja): vira regra "comparável entre lojas" (nacional) vs "equivalente por forma" (própria).
5. **Catálogos de marcas de topo como fonte-especialista** — enriquecer ~20-50 marcas nacionais grandes com nome canónico + estrutura de linha/posicionamento. Por-marca e frágil; só para o topo que cobre a maioria do volume de marca. NÃO para nutrição (loja ganha) nem preço (talões).
6. **Eixo "qualidade percebida" (reviews)** — 3.º eixo (preço+saúde+qualidade) para desempatar marcas equivalentes na prateleira; só nos processados; cuidado com fonte/ToS e com a postura factual. (Também no backlog do CLAUDE.md.)
7. **Higiene:** limpar as 442 linhas com marca `#REF!`.

## 3. Onde surgiram (para contexto)
Conversa exploratória 2026-06-12, a seguir aos ajustes da lista e ao caso do nome estrangeiro no scan (Penne em inglês → corrigido com "catálogo PT ganha ao OFF"). Sequência: nome→fontes→nutrição/classificação→reviews→marca→catálogo de marca.

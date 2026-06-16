# Visão multi-país (Europa) e a arquitetura de duas camadas

*Decisão de direção (dono, 2026-06-13): o app não é só para Portugal. Se sair do laboratório, utilizadores de outros países europeus vão querê-lo. Este doc fixa a arquitetura que torna isso viável sem reescrever tudo, e o que fazer (e não fazer) agora.*

## A ideia central: separar IDENTIDADE de PREÇO+LOCALE

Um produto tem uma **identidade universal** (o EAN/GTIN da Nutella 400 g é o mesmo em PT, ES, FR) e uma **realidade local** (preço, loja, idioma). Separar estas duas coisas é o que torna o app multi-país sem o reescrever:

### Camada 1 — IDENTIDADE (universal, partilhada, keyed-by-EAN)
Nome canónico, marca, nutrição, ingredientes, imagem + vetores, classificação, ligações cross-loja/cross-país. **Construída uma vez, beneficia todos os países.** Cada país que raspamos *enriquece a mesma camada* — um espanhol a escanear Nutella melhora a Nutella que o português vê.
- **Flywheel:** mais países → mais dados de identidade → melhor para todos.
- Já assenta em coisas agnósticas ao país: **EAN** (chave), **Open Food Facts** (base pan-europeia multilíngue por EAN), **match por imagem** (a aparência é universal), `fonte` tag.
- A OFF prova que uma base de produtos europeia por EAN funciona; o nosso diferencial é a camada que ela não tem: **preço real (talões) + personalização**.

### Camada 2 — PREÇO + LOCALE (por país, parametrizável)
Talões (factos de preço, por utilizador/país), conjunto de lojas relevantes, idioma de exibição, rótulos de secção, formato de talão/identificação fiscal. **Parametrizada pelo país/locale do utilizador**, não fixa a PT.

**Regra de ouro:** investir a fundo na Camada 1 (é tudo reaproveitável, sem locale) e manter a Camada 2 **parametrizável** em vez de PT-cravada.

### Afinação (dono, 2026-06-16): para um mesmo EAN, só o NOME e o PREÇO variam por país
As **ÚNICAS** características que variam de facto entre países são:
- **NOME** — e mesmo assim é a *mesma* identidade, só rotulada por mercado/idioma (uma **vista** por locale, não outro produto);
- **PREÇO** — que já varia dentro do mesmo país (por loja e no tempo).

**Todo o resto — nutrição, ingredientes, imagem, marca, dimensões, identidade-de-categoria — é UM pool partilhado** que cada fonte de cada país *enriquece* (o savegnago BR melhora a ficha que o PT vê; o OFF/Continente melhora a que o BR vê).

**Implicação no código** (`consolidarProduto`, 2026-06-16): nutrição/imagem/identidade resolvem-se **GLOBAIS por EAN** (qualquer fonte, sem restrição de país); o **NOME** é *preferido* pelas fontes do país mas **cai para qualquer fonte** (vista, não restrição); só o **PREÇO** é *restrito* às `fontesPreco` do país. **Regra: nunca restringir por país o que é partilhado.**

## O que já está pronto vs. PT-cravado

**Agnóstico / pronto:** EAN, OFF (`consultarOFF`), match por imagem, `fonte` tag, i18n da UI (`t()`, traduzir = juntar dicionário), moeda (PT/ES/FR são todos Euro), perfis/membros.

**PT-cravado — virar *locale-aware* quando se lhes tocar (não antes):**
- **Prompts do LLM** pedem "PT-BR + você" → parametrizar pelo locale do utilizador.
- **Resolvedor de nome PT-first** (`fichaEan`/Conceito) → **país-do-utilizador-first** (catálogo do país > traduzido; marcas nunca se traduzem).
- **Rótulos de secção** PT → os ids de grupo (`grupoDe`) já são neutros; só as *labels* traduzem (i18n trata).
- **Leitura de talão** assume cadeias e NIF PT → ES/FR têm cadeias e formatos fiscais próprios.

Nenhum é difícil isolado; o caro seria descobrir tarde que estão espalhados. Por isso: **locale-ready, não locale-completo.**

## Implicação para as fontes de catálogo

Escolher fontes de **gama completa com marcas nacionais/internacionais** (Auchan/Alcampo, Carrefour, Continente) e **não** as de marca-própria pesada. Medição real (2026-06-13): dos 5.013 EANs do Mercadona (ES, quase todo Hacendado) só **2%** existem no catálogo PT — private-label não atravessa fronteiras. O **Alcampo** (Auchan ES, mesma plataforma Demandware) deve ter sobreposição muito maior, porque carrega as mesmas marcas internacionais. Ver `Analise_Fontes_Normalizacao.md`.

## Postura pragmática (enquanto é laboratório, utilizador único)

1. **NÃO construir a maquinaria multi-país agora** — prematuro, abranda.
2. **Continuar a alimentar a Camada 1** (EAN, OFF, imagem, ligações cross-loja) — já é o que se faz; 100% reaproveitável.
3. **Parar de cravar PT mais fundo**: quando se mexer num prompt, no resolvedor de nome ou na leitura de talão, deixá-los a receber um `locale`/`país` (mesmo que o valor seja sempre `pt-PT` por agora).
4. **País nº 2 óbvio = Espanha** (Euro, fronteira de marcas partilhada com PT, Alcampo/Mercadona já em parte). Quando se sair do laboratório, arranca-se a Camada 2 para esse locale.

## 1.ª concretização: a Camada LOCALE existe (2026-06-16)

A postura "locale-ready, não locale-completo" deixou de ser só intenção — há agora uma implementação real, mínima e aditiva. O país nº 2 acabou por ser o **Brasil** (PT-BR já é a língua-base do app), não a Espanha, mas a arquitetura é a mesma.

**Camada 2 parametrizada (PREÇO+LOCALE):**
- **Migração 062** `usuario` (`email` PK, `pais` CHAR(2) default `PT`, `locale` default `pt-BR`) — aditiva; o país resolve-se por email.
- **`config.paises`** (`backend/src/config.js`, fonte única): `PT` → `{ moeda: EUR, símbolo: €, fontesPreco: [continente, auchan, pingodoce, lidl, mercadona, …] }`; `BR` → `{ moeda: BRL, símbolo: R$, fontesPreco: [savegnago, zaffari, supernosso, comper, atacadao, supermuffato, prezunic, zonasul, carone, giassi, mambo, condor, assai, dia-br] }`. `paisCfg(pais)` dá moeda/símbolo/fontes com fallback ao default.
- **`resolveLocale(email)`** (`auth.js`, cacheado, nunca bloqueia a auth): lê/cria a linha em `usuario` → `req.user` ganha `pais`/`locale`/`moeda`/`simbolo`. `POST /api/me/pais` (PT/BR) persiste + invalida o cache.
- **`/info`** (`consolidarProduto`, `routes/produto.js`): o preço de catálogo (referência) sai na moeda do país do utilizador, pescado só das `fontesPreco` desse país (PT→€/lojas PT; BR→R$/lojas VTEX). A IDENTIDADE (nutrição/imagem/marca por EAN) continua global.
- **Frontend** (`v2/AppV2.jsx`): seletor de país (PT/BR) no menu do avatar; mudar persiste e **recarrega a app** na nova moeda/locale (`fmtPreco` formata € ou R$).

Isto valida a regra de ouro na prática: a Camada 2 ficou num punhado de pontos parametrizáveis (uma tabela, um mapa de config, um resolvedor, um endpoint, um seletor) — **sem tocar na Camada 1**.

## Entrada no Brasil — fontes de catálogo (2026-06-16)

O Brasil entrou pelo **retalho em VTEX**, a plataforma dominante do retalho BR (`Metodologia_Descoberta_Fontes.md`): um **único adaptador** (`backend/scripts/harvest_vtex.mjs`) colhe qualquer loja VTEX pela API pública `/<host>/api/catalog_system/pub/products/search` → **EAN + nome + marca + categoria-path + preço R$ + imagem**. Mede-se a sobreposição por amostra (em `savegnago`: 446 EANs → ~44% novos, nem no catálogo nem no `off_full`) — alimenta **as duas camadas de uma vez**.

- **VTEX** (~11 mercados regionais): savegnago, zaffari, supernosso, comper, atacadao, prezunic, zonasul, carone, giassi, supermuffato, mambo (+condor long-tail). EANs + preço + categoria BR.
- **Pão de Açúcar (GPA)** via API Linx (`harvest_paodeacucar.mjs`, fonte `paodeacucar`) — sem EAN no payload (corpo para match por imagem), por isso não entra nas `fontesPreco`.
- **Carrefour BR — BLOQUEADO** (Cloudflare/503 no endpoint VTEX; varia por loja). Pendente: captura em browser (IP residencial).
- Nomes vêm em **PT-BR** (língua-base do app) → **não passam pela tradução LLM** (ao contrário das fontes ES/FR).

**Ligação às duas camadas:** cada EAN BR colhido **enriquece a IDENTIDADE universal** (o pool partilhado por EAN — o savegnago melhora a ficha que o PT vê, e vice-versa), enquanto a sua linha de **PREÇO+LOCALE** (R$, loja BR) só conta para quem tem `pais=BR`. É a arquitetura de 2 camadas a funcionar com um país real, não só PT.

## Estado relacionado
- Match cross-loja por imagem+metadados (PD→catálogo): ver `match-por-imagem-estado` (memória) e `catalogo_match`. É o motor que liga o mesmo produto entre lojas/países sem depender da escrita.
- Vertical Espanha+Mercadona: `Vertical_Espanha_Mercadona.md` (ideia de produto anterior, agora subsumida nesta visão mais ampla).

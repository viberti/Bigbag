# Metodologia de Descoberta de Fontes (por país)

> Como encontrar **fontes locais de informação de produto** (EAN → nome, marca, nutrição, ingredientes, foto, categoria, preço) ao estender o BigBag a um novo país. Destilada do que fizemos para **Portugal** (PrestaShop .pt, Auchan não-food, Nutripédia, brand-stores Shopify) e validada no **Brasil** (ver §7). Companion de [`Visao_Multi_Pais.md`](Visao_Multi_Pais.md).

## 0. Princípio (porque é que isto funciona)
- **O EAN é a chave universal.** Uma fonte alimenta uma de duas camadas (ver Visão Multi-País):
  - **IDENTIDADE** (EAN → nome/marca/nutrição/ingredientes/foto/categoria) — **agnóstica de país, partilhada**, enriquece com cada país.
  - **PREÇO + LOCALE** (preço, disponibilidade, nome-de-talão) — **por país**.
- **O método é agnóstico de país; as fontes é que são locais.** Os mesmos 6 passos e a mesma taxonomia repetem-se em qualquer país — só mudam os domínios.
- **Custo de acesso é critério de triagem (dono, 2026-06-16):** isto é um lab pessoal → **preferir fontes abertas/gratuitas**. Ranking: **aberto/grátis** (OFF, Wireshape, scrape de lojas) **> grátis-com-token** (registo de conta) **> comercial/pago** (ex. Cosmos/Bluesoft) — pago só como *fallback* de último recurso, nunca o caminho principal.
- **Antes de colher, mede o que já tens DE GRAÇA.** O `off_full` (OFF, aberto) já cobre muito por país — ex. BR: **32 300 produtos `789/790`, 21,8k c/ nutrição, 20,4k c/ imagem, já ligados ao `fichaEan`**. Não reconstruir o que o OFF já dá; caçar só o que ele NÃO tem (não-food, preço+locale, cauda local).

## Os 6 passos: SEMENTE → DESCOBRIR → CLASSIFICAR → SONDAR → MEDIR → COLHER

### 1. SEMENTE — escolher EANs locais populares, em várias categorias
- Usar o **prefixo GS1 do país** para isolar produtos locais: PT/ES `560`/`84`, **BR `789`/`790`**, FR `30-37`, etc.
- Tirar de `off_full` (filtrar por prefixo + tem imagem/nutrição = bem documentado = popular) ou de staples conhecidos.
- ~10-15 EANs cobrindo **categorias-base** (arroz, feijão, café, leite, açúcar, óleo/azeite + alguns não-alimentares). Popular = muito indexado = faz emergir muitas fontes.

### 2. DESCOBRIR — EAN → busca web
- Buscar **cada EAN cru** (+ nome). Os domínios que indexam aquele número **são** as fontes candidatas (um EAN é uma chave precisa; quem o mostra é fonte de dados de produto).
- Agregar os domínios de todas as buscas; **deduplicar e contar frequência**. *Um domínio que aparece para MUITOS EANs = fonte ampla/central = prioridade máxima* (foi assim que o **Cosmos** saltou no BR e a **Nutripédia** no PT).

### 3. CLASSIFICAR — arrumar os domínios por TIPO (taxonomia recorrente)
1. **Registo-EAN / agregador** (o *jackpot*) — indexado por EAN, cobertura ampla, muitas vezes com dados locais extra (NCM/tributação no BR, nutrição). *PT: Nutripédia · BR: **Cosmos (Bluesoft)**, Wireshape · global: OFF, codecheck, upcitemdb.*
2. **Retalho e-commerce** (supermercados) — preço + categoria-de-loja + nome; EAN às vezes no URL/JSON-LD. **A melhor fonte da camada PREÇO+LOCALE.**
3. **Fabricante** — só expõe EAN se tiver **loja online** (Shopify/PrestaShop/Woo). Sites-montra (marketing) **não** dão EAN, só foto/nutrição (enriquecimento). *Regra provada no PT (Vieira de Castro Shopify dá; Compal/Nestlé não).*
4. **Diáspora / exportação** — lojas que vendem os produtos do país no estrangeiro (muitas PrestaShop com EAN-no-URL). Cobrem as mesmas identidades; redundância útil + fotos.
- Marcar `.<cc>` local vs global.

### 4. SONDAR — checklist técnico de recolhabilidade (por candidato de topo)
- **robots.txt** — o que é permitido; há `Sitemap:`?
- **sitemap.xml** — enumerável? quantos URLs de produto? (dá o **tamanho do universo**)
- **EAN exposto?** no slug do URL? `gtin13` no JSON-LD? `barcode` no `/products/<slug>.json` (Shopify)? tabela de especificações?
- **Dados estruturados** — JSON-LD Product? *transfer-state* (JSON inline)? `og:image`?
- **SSR vs SPA** — o HTML servido já traz os dados, ou é só JS?
- **Anti-bot** — Cloudflare 403 a IP de datacenter? (→ recolher de **IP residencial**). 429 rate-limit? (→ **backoff** + concorrência baixa). Login/API-token? (→ **o utilizador regista**, nunca o agente).
- **Campos disponíveis** — EAN, nome, marca, categoria, preço, nutrição, ingredientes, imagem.

#### Atalho: reconhecer a PLATAFORMA dá o método de recolha na hora
| Plataforma | Sinal | Como colher o EAN |
|---|---|---|
| **PrestaShop** | `…-<13díg>[.html]`, `?page=N` | EAN no slug do URL (crawl categorias+paginação) |
| **Shopify** | `/products.json`, `/products/<slug>.json` | `variants[].barcode` (o bulk omite-o; a ficha tem) + `gtin13` no JSON-LD |
| **SFCC/Demandware** | `sitemap_index.xml` → `*-product.xml` | JSON-LD Product (Auchan/Continente/PD/Mercadona) |
| **WooCommerce** | sitemaps `wp`, `/product/` | JSON-LD + tabela de atributos |
| **Angular/Vue transfer-state** | `<script type="application/json">` com a resposta da API inline | parse do blob (Nutripédia: chave = base64 do path da API) |
| **Registo custom** (Cosmos) | página por `/<ean>-<slug>` | normalmente **API com token** (registo grátis) |

### 5. MEDIR — compensa?
- Amostrar **N** itens, extrair EANs, e medir **novidade** (quantos são novos vs `catalogo_produto` + `off_full`) e que **campos preenche** (nutrição em falta, imagem, não-food, categoria-de-loja local, preço).
- Uma fonte **compensa** se traz EANs novos **ou** preenche um campo em falta (Nutripédia: nutrição; PrestaShop PT: não-food; Auchan: corredores não-alimentares).
- Ranquear: **registo-EAN amplo > preenchedor de não-food/cauda-longa > redundante (só foto/preço)**.

### 6. COLHER — construir/apontar um harvester
- **Reutilizar um harvester por plataforma** (temos: PrestaShop `harvest_lojas_pt.mjs`; SFCC `scrape_catalogo.mjs`; transfer-state `harvest_nutripedia.mjs`; Shopify genérico — pendente).
- **Educado e robusto:** UA claro, concorrência baixa, delay, backoff no 429, **resumível**, **idempotente** (DELETE por fonte + INSERT).
- **Correr onde o anti-bot deixa:** residencial (PC) vs servidor. Separar recolha (escreve NDJSON) de carregamento (BD) quando o servidor está bloqueado (caso Nutripédia/Cloudflare, caso Cosmos).
- **Carregar em `catalogo_produto`** (`fonte=<nome>`), 1 linha por (produto, EAN) → a fusão `fichaEan` apanha. Pôr a fonte em `FONTES_PT`/`FONTES_<cc>` se os nomes forem do idioma local fiável.

## 7. Exemplo trabalhado: BRASIL (validação, 2026-06-16)
SEMENTE: 18 EANs `789…` do `off_full` (Pilão, União, Camil, Yoki, Hellmann's, Moça, Nescau, Ninho, Sadia, Maizena, Nissin, Mucilon…). DESCOBRIR: 6 buscas. Resultado da CLASSIFICAÇÃO:

**Base GRÁTIS que já temos:** `off_full` (OFF, aberto) = **32 300 produtos BR `789/790`** (21,8k nutrição, 20,4k imagem), já ligado ao `fichaEan`. É o backbone da identidade-alimentar BR a custo zero. O `catalogo_produto` BR é só 387. → no BR já partimos cobertos no alimentar; caçar o que o OFF NÃO tem.

Fontes por tipo (com **custo de acesso**):
- **Registo-EAN ABERTO (o caminho): `data.wireshape.com`** (Wireshape / "Smart Consumer") — robots `Allow: /` + sitemap (enumerável), JSON-LD, EAN+nutrição+imagem+marca, **sem bloqueio (200)**. Grátis. *+ a API aberta do OFF-BR (`br.openfoodfacts.org/api/v2/product/<ean>.json`).*
- **Registo-EAN PAGO (fallback, NÃO usar): `cosmos.bluesoft.com.br`** — registo central BR (GTIN+nome+NCM), apareceu 1.º para os 6 EANs, mas é **empresa comercial de acesso pago** (web 403, API 401/token). Bom mas pago → preterido (dono, 2026-06-16).
- **Retalho e-commerce BR (camada preço+locale), vários com EAN-no-URL — grátis (scrape educado):** `condor.com.br/product/<EAN>`, `superkan.com.br/.../<EAN>/d`, `davo.com.br/.../prod_<EAN>`, `redemix.com.br/<EAN>…/p`, `mercado.carrefour.com.br`, `zaffari.com.br`, `savegnago.com.br`, `coopsupermercado.com.br`, `nicolini`.
- **Fabricante:** `pilao.com.br`, `camil.com.br`, `yoki.com.br`, `uniao.com.br`, `nestle.com.br` — montra (por slug, provável sem EAN). Exceção a confirmar: `hellmanns.com.br/p/<slug>.html/<EAN>`.
- **Diáspora/exportação** (PrestaShop com EAN-no-URL): `bomsabor.ch/...-<EAN>.html`, `everydaybrazil.com`, `hibrazilmarket.com`, `kingfoodbrasil.com.br`, `natubrazil.com`.

**Leitura:** o BR confirma o padrão E a regra do custo — o registo central mais visível é **pago (Cosmos)**, mas existe um **registo aberto equivalente (Wireshape)** + a base OFF que já temos. Próximo passo BR (free-first): (1) sondar a fundo o Wireshape (universo no sitemap, campos no JSON-LD) e medir novidade vs off_full; (2) 2-3 retalhistas BR com EAN-no-URL para a camada preço+categoria-local; (3) Cosmos só se faltar algo que mais nada dê.

## 8. Registo de Fontes (doc vivo, por país)
Manter uma tabela por país: **fonte · tipo · plataforma · EAN-exposto · campos · universo · estado · novidade**. É o roadmap da expansão. (PT atual: Nutripédia, lojas PrestaShop .pt, Auchan/Continente/PD/Lidl, Mercadona-ES, Lidl-FR — ver `Analise_Fontes_Normalizacao.md`.)

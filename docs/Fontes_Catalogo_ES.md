# Fontes de catálogo em Espanha — endpoints vivos (probe 2026-06-13)

*Mapa de APIs de supermercados espanhóis, para a camada de PREÇO (e alguns, EAN) quando arrancarmos Espanha. Origem da pista: repo `ivanmritx/superfinder-backend` (Java, 2023, endpoints já parcialmente mortos) → re-testados por nós. Ver `Visao_Multi_Pais.md` (arquitetura de 2 camadas).*

## Estado real dos endpoints (probe ao termo "aceite")

| Cadeia | Endpoint (search por termo `q`/`term`) | Estado | EAN? |
|---|---|---|---|
| **Consum** | `tienda.consum.es/api/rest/V1.0/catalog/searcher/products?q=&limit=&showRecommendations=false` | ✅ **JSON 200** | ✅ **EAN global real** + marca + nome + imagem + preço |
| **Dia** | `dia.es/api/v1/search-back/search/reduced?q=&page=1` | ✅ JSON 200 | ❌ só `object_id` interno |
| Eroski | `supermercado.eroski.es/es/search/results/?q=&suggestionsFilter=false` | ⚠️ 200 **HTML** | (parsing de HTML) |
| Carrefour | `carrefour.es/search-api/query/v1/search?query=&...` | 🔒 **Cloudflare** — homepage 200, mas a API dá 403 mesmo com cookie `__cf_bm` da sessão (valida o **fingerprint TLS**; o curl não passa). Precisa de browser real / `curl-impersonate`. | ? (não verificado) |
| Hipercor (El Corte Inglés) | `hipercor.es/...` | 🔴 **Akamai (AkamaiGHost)** — bloqueia **TUDO**, até o `robots.txt` e a homepage (403 de IP de datacenter). O mais defendido; só com browser headless + stealth (+ talvez proxies residenciais). **Saltar.** | — |
| Alcampo | `compraonline.alcampo.es/api/v5/products/search?term=` | 💀 404 (v5 morta) | — (ficha web tem nutrição/ingredientes mas **não** EAN) |
| Masymas | `supermasymasonline.com/listado_PDO.php?buscar=` | 💀 404 | — |
| Alimerka | `alimerkaonline.es/ali-ws/tienda/busqueda/.../false/1/1000/0` | 💀 404 | — |
| Mercadona | Algolia `7uzjkl1dj0-dsn.algolia.net/.../products_prod_4315_es/query` | (chave de 3.º no repo; já temos o Mercadona por outra via) | — |
| Aldi | Algolia `l9knu74io7-dsn.algolia.net/1/indexes/*/queries` | (idem) | — |

**Vivos e úteis: Consum (com EAN) e Dia (sem EAN).** Carrefour/Hipercor existem mas bloqueiam (recuperáveis com trabalho de cabeçalhos/sessão). O resto morreu.

## Consum — o achado (fonte ES COM EAN)

`scripts/test_consum.mjs` extraiu por 30 termos de comida (limit 40):
- **1.098 produtos distintos com EAN global válido** (84… = Espanha), 0 erros de fetch.
- **106 já no nosso catálogo PT** (Continente/Auchan) — **mesmo EAN, juntam direto, sem matching**. São marcas internacionais: Nescafé, Lavazza, Dolce Gusto, L'OR, Giovanni Rana…
- 39 já no nosso OFF · **938 EANs NOVOS** (ganho de identidade: Carbonell, Coosur, Hojiblanca + cauda).

**Prova concreta da tese cross-fronteira:** o mesmo GTIN (ex.: Lavazza `8000070019362`, Dolce Gusto `7613034365774`) aparece no Consum-ES e no nosso catálogo-PT → ligação por EAN, gratуita. Extrapolando do probe (30 termos), o catálogo Consum completo (dezenas de milhar) renderia milhares de sobreposições + dezenas de milhar de EANs novos.

Estrutura da resposta: `catalog.products[]` → `{ ean, code, productData:{name, brand:{id}, imageURL, attributes, format}, priceData:{prices[]}, media:[{url,order,type}] }`.

**Tem EAN + preço + marca + FOTOS** (fonte completa). Dois gotchas confirmados:
- **Imagem:** usar **`media[].url`** (300×300 JPEG, ~10-16 KB, baixam 200), **NÃO** `productData.imageURL` (esse dá **404** — está partido). Há ≥1 foto por produto (`_001`, `_002`…).
- **Preço:** fica em `priceData.prices[]` (lista aninhada) — o `test_consum` ainda não o apanha (saiu `[object Object]`); achar o campo certo (`value`/`price`) quando for a sério.

Como tem foto, o Consum serve a **ambos** os caminhos: EAN-join direto (overlap) **e** vetorização+match por imagem (o resto).

## Como usar (quando for a vez de Espanha)

- **Consum**: search-por-termo (20–40/query) → enumerar por termos/categorias (tem facetas) ou achar sitemap. Traz **EAN+preço+marca+imagem** — junta-se ao catálogo por EAN direto (sem imagem) para a sobreposição; o resto entra como produto ES com EAN.
- **Dia / Eroski**: sem EAN / HTML → ligar por **imagem+marca+peso** (a maquinaria do PD).
- **Carrefour / Hipercor**: maiores; vale o esforço anti-bot mais tarde.
- **Volume de EANs europeus continua a ser o OFF** (milhões) — o Consum é complementar (ES + preço + corroboração de EAN), não substituto.

## E.Leclerc — ES viável (a raspar), PT sem catálogo online (2026-06-14)

**E.Leclerc ES — FONTE VIÁVEL, `importar_leclerc.mjs`** (fonte=`leclerc`). Não tem API/sitemap de produtos: a loja vive nos **subdomínios regionais** (`pamplona.e-leclerc.es`, `soria.e-leclerc.es`…), plataforma **comerzzia/Liferay**, paginação por AJAX jQuery (difícil). Solução: **crawl BFS** — cada ficha liga a ~15-20 relacionados, por isso a partir das **13 categorias-semente** (`/categorias/<nome>/NN`) descobre-se o catálogo todo seguindo os links `/detalle/-/Producto/<slug>/<EAN>`.
- **Dá:** EAN (último segmento do URL) + nome + marca + preço + €/base. Piloto: **83/83 com EAN válido**, marca 90%, ~86% EANs NOVOS.
- **Gotchas:** (1) o **JSON-LD é INVÁLIDO** (`availability:'InStock'` com aspas simples) → `JSON.parse` falha; extrair campos por **regex** no bloco ld+json. (2) **IMAGEM não-fiável** — é EAN-keyed mas o ficheiro está errado (caso Penne↔Pipe Rigate, verificado); **NÃO guardar imagem**. (3) **Sem nutrição** (o site só põe um disclaimer "contacte o apoio"). (4) Preço é da loja regional → referência, não facto.

**E.Leclerc PT — SEM FONTE ONLINE.** O `e-leclerc.pt` é WordPress **puramente institucional** (sitemap só `post-`/`page-`; links úteis só `/lojas/` e `/retirada-de-produtos/`). Sem loja online, sem comerzzia, sem subdomínios regionais — opera só em loja física. **Não retentar.** A identidade que interessaria (marcas internacionais com EAN partilhado) já entra pelo Leclerc **ES** via EAN cross-fronteira.

# Fontes de catálogo em Espanha — endpoints vivos (probe 2026-06-13)

*Mapa de APIs de supermercados espanhóis, para a camada de PREÇO (e alguns, EAN) quando arrancarmos Espanha. Origem da pista: repo `ivanmritx/superfinder-backend` (Java, 2023, endpoints já parcialmente mortos) → re-testados por nós. Ver `Visao_Multi_Pais.md` (arquitetura de 2 camadas).*

## Estado real dos endpoints (probe ao termo "aceite")

| Cadeia | Endpoint (search por termo `q`/`term`) | Estado | EAN? |
|---|---|---|---|
| **Consum** | `tienda.consum.es/api/rest/V1.0/catalog/searcher/products?q=&limit=&showRecommendations=false` | ✅ **JSON 200** | ✅ **EAN global real** + marca + nome + imagem + preço |
| **Dia** | `dia.es/api/v1/search-back/search/reduced?q=&page=1` | ✅ JSON 200 | ❌ só `object_id` interno |
| Eroski | `supermercado.eroski.es/es/search/results/?q=&suggestionsFilter=false` | ⚠️ 200 **HTML** | (parsing de HTML) |
| Carrefour | `carrefour.es/search-api/query/v1/search?query=&...` | 🔒 403 anti-bot | API existe; precisa sessão/cabeçalhos |
| Hipercor (El Corte Inglés) | `hipercor.es/alimentacion/api/catalog/supermercado/type_ahead/?question=&...` | 🔒 403 anti-bot | idem |
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

Estrutura da resposta: `catalog.products[]` → `{ ean, code, productData:{name, brand:{id}, imageURL, attributes, format}, priceData:{prices[]} }`. (O campo de preço fica em `priceData.prices[]` — a extração precisa do índice/campo certo; o `test_consum` ainda não o apanha bem.)

## Como usar (quando for a vez de Espanha)

- **Consum**: search-por-termo (20–40/query) → enumerar por termos/categorias (tem facetas) ou achar sitemap. Traz **EAN+preço+marca+imagem** — junta-se ao catálogo por EAN direto (sem imagem) para a sobreposição; o resto entra como produto ES com EAN.
- **Dia / Eroski**: sem EAN / HTML → ligar por **imagem+marca+peso** (a maquinaria do PD).
- **Carrefour / Hipercor**: maiores; vale o esforço anti-bot mais tarde.
- **Volume de EANs europeus continua a ser o OFF** (milhões) — o Consum é complementar (ES + preço + corroboração de EAN), não substituto.

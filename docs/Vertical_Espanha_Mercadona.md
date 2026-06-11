# Vertical Espanha + Mercadona (backlog — explorar com talão real)

> Ideia de produto levantada a 2026-06-11. **Estado: anotada, à espera de um talão
> espanhol real para validar a leitura.** O dono vai conseguir um.

## A tese

O problema **mais difícil** do Bigbag é a resolução de identidade de produto a partir
de talões sujos e **multi-cadeia** (catálogos incompletos: discounters não publicam,
Continente bloqueia por anti-bot). Num cenário **Espanha + Mercadona**, esse problema
quase desaparece — e o Mercadona é **~26% do retalho alimentar espanhol** (a cadeia
nº 1, com os dados mais limpos). Como **laboratório**, é uma demonstração *mais limpa*
do conceito (histórico de preços + conselheiro de saúde) do que a realidade confusa
de Portugal, porque isola o valor e remove a parte frágil (entity resolution).

## O que já temos (medido 2026-06-11)

- **100% do sortido Mercadona** — 4.375 produtos (o Mercadona usa um catálogo
  deliberadamente curto, ~4-5k SKUs, "siempre los mismos productos"; o Continente tem
  98k). Todos com **EAN**, marca, embalagem, preço, €/base (`reference_price`) e
  categorias a 3 níveis. Em `catalogo_produto` fonte `mercadona`.
- Via **API JSON pública** `tienda.mercadona.es/api` — limpa, sem fricção de scraping,
  atualizável diariamente (`scripts/scrape_mercadona.mjs`).
- Nutrição: **não vem na API**, mas EAN→OFF preenche (Hacendado tem 815+ no OFF).

## Porque o problema difícil colapsa

| Dificuldade no Bigbag PT | Espanha + Mercadona |
|---|---|
| 6 cadeias, cada uma com formato/abreviaturas/IVA próprios | **1 cadeia** → 1 convenção |
| Catálogo incompleto (discounters/Continente) | **Catálogo 100% completo**, oficial |
| Matching fuzzy nome→EAN com juiz humano | Sortido curto + EAN → match quase trivial |
| Marca-própria adivinhada por prior | Quase tudo é **Hacendado** (conhecido) |

→ Toda a **Fase A** (motor de busca, gazetteer, mineração de abreviaturas, facetas),
feita para *compensar* a falta de catálogo, passa de "andaime essencial" a "bónus".

## O que falta validar (por ordem)

1. **A leitura do talão espanhol real** (o input e o risco reais) — temos talões do
   Mercadona *português*; o formato/abreviaturas dos talões *de Espanha* podem diferir.
   **Passo decisivo: testar a extração + o match contra o catálogo que já temos, com
   UM talão ES de verdade.** ← à espera disto.
2. **Confirmada a leitura**, o resto é mecânico:
   - **Dicionário espanhol** no `i18n.js` (a app já é i18n-ready, base PT-BR desenhada
     para localizar — é adicionar um dicionário, os componentes não mudam).
   - **Refresh diário do catálogo** Mercadona via cron (o scraper é resumível/idempotente).
   - **Preço online como REFERÊNCIA** — em PT o preço do catálogo é inútil (Espanha);
     aqui passa a funcionalidade nova impossível em PT: "isto saiu mais caro/barato que
     online?", lista de compras com preço ao vivo, lista preditiva com preço real.
3. Decisão de âmbito: continua **laboratório** (utilizador único) ou evolui para
   multi-utilizador (auth/suporte — maior compromisso). Como vertical de lab, não precisa.

## Experiência validada (2026-06-11): tradução ES→PT do catálogo

Hipótese: os itens de talão Mercadona (PT) casavam no catálogo **Auchan/Continente**
(nomes PT) em vez do **próprio Mercadona** (nomes ES) — "MOZZARELLA" batia "Queijo
Mozzarella Galbani" (Auchan) e não "Queso Mozzarella Hacendado" (Mercadona). Pior:
casava no **produto errado** (Galbani ≠ Hacendado).

Teste (`scripts/exp_match_mercadona.mjs`, A/B na worklist Mercadona, 21 itens sem EAN):
- **Baseline** (catálogo ES): só **3/21** na própria cadeia.
- **+ tradução por léxico** (`scripts/traduzir_mercadona.mjs`, ES→PT determinístico,
  sem LLM, coluna `catalogo_produto.nome_pt`; `buscarCatalogo` tokeniza nome_pt):
  ainda 3 — a tradução **sozinha não chegou**.
- **+ correção do prior de cadeia** (achado: o Mercadona e o lidl-fr nem estavam no
  `FONTE_POR_CADEIA` → o +0,12 que desempata p/ a própria loja **nunca se aplicava**):
  **11/21** no match direto, **14** nas propostas geradas.

Os que continuam a casar cross-cadeia são **marcas nacionais** (Gullon, Chips Ahoy,
Lacasa, Agros) — onde o EAN é o mesmo em qualquer catálogo, logo está **correto**.

**Conclusões:** (1) a tradução do catálogo é **valor permanente também em PT** —
corrigiu matches errados de marca-própria Mercadona (Hacendado passou a resolver no
produto certo). (2) Para o **vertical ES**, onde ~tudo é Hacendado, isto é o catálogo
inteiro a resolver corretamente — reforça a tese. (3) Um léxico ES→PT (sem LLM) chega
para o matching; tradução fluente (LLM) só seria precisa para o nome de exibição.

## Notas

- O preço do **histórico** continua a vir do **talão real** (como em PT) — o catálogo
  só dá identidade/nome/nutrição + agora o preço-online-de-referência.
- O eixo saúde (nutrição, perfis, comparar) funciona igual — e com Mercadona+OFF a
  cobertura nutricional fica excelente.

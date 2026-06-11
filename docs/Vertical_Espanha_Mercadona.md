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

- **100% do sortido online NACIONAL Mercadona** — **5.060 produtos** (união de 6
  warehouses, 2026-06-11; o scrape inicial só de Madrid dava 4.375 — o sortido
  regional valia **+17%**). O Mercadona usa um catálogo deliberadamente curto,
  ~5k SKUs, "siempre los mismos productos"; o Continente tem 98k. Todos com **EAN**
  (5.060/5.060), marca, embalagem, preço, €/base (`reference_price`) e categorias
  a 3 níveis. Em `catalogo_produto` fonte `mercadona`.
- Via **API JSON pública** `tienda.mercadona.es/api` — limpa, sem fricção de scraping,
  atualizável diariamente (`scripts/scrape_mercadona.mjs`).
- **Warehouses (`?wh=`)**: a API serve sortidos **diferentes por zona** — medido
  2026-06-11 na união completa: mad1 4.330 · mad2 +16 · bcn1 +267 · vlc1 +180 ·
  svq1 +185 · alc1 +81 = **5.059 únicos (+17% sobre Madrid)**. **Preços iguais**
  entre warehouses (preço único nacional). O scraper aceita `WH=mad1,bcn1,…` e
  **une** os sortidos (incremental via `SO_NOVOS`); manter a união nos refrescos.
  Referências externas: `m0wer/mercaapi` (nutrição+histórico), `josantonius/php-mercadona-importer`.
- **Portugal NÃO existe na API (testado 2026-06-11):** o `wh` não é validado —
  código desconhecido cai silenciosamente no default (controlo-lixo `zzz9` ≡ `bra1`/
  `opo1`/`lis1`, 0 diferenças; `bcn1` difere de verdade). Os warehouses servem o
  e-commerce ES (colmenas); as lojas físicas PT não têm representação. `lang=pt` é
  fallback para ES (`lang=ca` e `lang=en` funcionam de verdade — não há PT oficial;
  o léxico ES→PT `nome_pt` mantém-se). **Preços Mercadona PT só via talões reais**
  (IVA ES 4/10/21 ≠ PT 6/13/23 — nem podiam coincidir).
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

## Aprofundamento da análise (2026-06-11) — harness de verdade-no-terreno

Os produtos que o dono **scaneou** (item.ean) são pares *nome↔EAN* reais →
`scripts/exp_mercadona_groundtruth.mjs` mede se o matcher (restrito ao universo
Mercadona) acerta. Achados:

- **Universo restrito** (decisão do dono): o match Mercadona corre só sobre
  `['mercadona','mercadona-off']`, **nunca** Continente/Auchan — em vez de pesar a
  marca (ausente no talão + ~não-discriminativa), limita-se o universo. `buscarCatalogo`
  ganhou `fonteUnica` (lista). A **marca não entra no match** (o talão não a mostra).
- **off_produto own-brand integrado** (`importar_off_mercadona.mjs`, fonte
  `mercadona-off`): +586 produtos que o scrape não tinha, **540 com nome PT da
  comunidade** (dispensam léxico). Cobertura avaliável 10→21.
- **BUG do formato (corrigido, grande impacto):** `extrairFormato` devolve o default
  `{un,1}` quando o talão não traz tamanho — e isso era tratado como um formato real
  que **conflituava (−0,3)** com todo o candidato dimensionado ("LEITE MEIO GORDO" sem
  litros perdia para o leite de 6 L). Só se compara formato quando o talão o declara.
  **Acerto-no-topo 3→10/21.**
- **Prior do "simples":** candidato que acrescenta faceta de dieta que o talão não
  pede (sem lactose · bio · zero) fica abaixo do normal (`buscarCatalogo`, −0,06/faceta).
- **Léxico ES→PT alargado** com os casos que o harness expôs: `aceite`→óleo (só
  "aceite de oliva"→azeite, via frase), `girasol`→girassol, `griego`→grego,
  `boquerones`/`caballa`/`aliñados`, + ~40 palavras completamente diferentes.

**Resultado:** ~14/21 produto certo (10 no topo + 4 mesmo-produto-EAN-irmão); o resto
tem o certo nas alternativas ou é ruído. **O que resta NÃO é defeito do matcher:**
- **Múltiplos EANs por produto** — o código de barras do produto FÍSICO em PT ≠ o do
  catálogo online ES (re-embalamento / SKU regional). O matcher dá o produto certo
  (nome idêntico), EAN-irmão. **O EAN que o dono scaneia é o autoritativo** → não é
  problema no fluxo real (scan resolve; o match por nome é p/ os não-scaneados).
- **Cobertura no teto** do catálogo online (5.060 = sortido online nacional completo, sem mais
  nível na API): 9/30 EANs são só-da-loja-física ou códigos de balança (prefixo 2) —
  irrecuperáveis por scraping. (FatSecret tem alguns, mas SEM EAN e licença restritiva
  → rejeitado como fonte; ver análise no histórico.)
- **Fossos de vocabulário descritivo** (não de cobertura): "BATATA PALITOS FINOS"
  existe como "Patatas Prefritas Corte Fino" mas "palitos"≠"prefritas corte"; "SALEIRO
  SAL DE MESA" o "saleiro" à frente atrapalha. Casos para o operador resolver à mão.

→ **Reforça a tese ES**: lá o talão é espanhol, o catálogo é espanhol, e o código de
barras do produto físico **é** o do catálogo online — múltiplos-EANs e léxico desaparecem.

## Notas

- O preço do **histórico** continua a vir do **talão real** (como em PT) — o catálogo
  só dá identidade/nome/nutrição + agora o preço-online-de-referência.
- O eixo saúde (nutrição, perfis, comparar) funciona igual — e com Mercadona+OFF a
  cobertura nutricional fica excelente.

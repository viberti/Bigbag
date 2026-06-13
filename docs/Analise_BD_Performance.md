# Análise da base de dados — performance, índices e o esquema de fontes/EANs

*2026-06-13. Auditoria pedida pelo dono: tabelas otimizáveis? queries lentas? faltam índices ou tabelas de relação? o esquema de "fontes separadas, cada uma com os seus EANs" é o melhor? Dados reais via `scripts/audit_bd.mjs` (só leitura) + inventário das queries no código.*

## TL;DR (o veredito)

1. **Performance de BD NÃO é o teu problema.** A base é **pequena** (a maior tabela tem 62k linhas / 35 MB) e **bem indexada**. A lentidão da despensa que corrigimos era **algorítmica** (trabalho CPU por-item em `resolverItensLista`), não falta de índices.
2. **Um único ponto fraco real de BD:** `catalogo_produto.nome LIKE '%…%'` faz *full-scan* de 62k linhas. Não é latência do utilizador (corre na **ingestão** e na estimativa de preço), mas é o que vale a pena melhorar (FULLTEXT).
3. **A tua intuição sobre as fontes separadas está certa — mas é um problema de COMPLETUDE, não de performance.** O universo de EANs está em 2 tabelas (catálogo 42k + OFF 22k, só 5,9k em comum); qualquer caminho que leia só uma perde dados. A correção certa é de *código* (um resolvedor único) + opcionalmente uma *vista/registo* de EANs — não um redesenho por performance.

---

## 1. Tamanhos reais (a BD é pequena)

| Tabela | Linhas | Dados | Índice | Nota |
|---|---:|---:|---:|---|
| `catalogo_produto` | 62.272 | 34,6 MB | 15,6 MB | a única "grande"; 5 fontes |
| `off_produto` | 22.477 | 20,5 MB | 1,5 MB | dump Open Food Facts |
| `evento_uso` | 9.502 | 1,5 MB | telemetria |
| `custo_chamada` | 5.261 | 0,5 MB | custos por feature |
| `produto_ean` | ~290 | 1,5 MB | fiches fundidas (052) |
| `item` | ~680 | 0,1 MB | **linhas de talão** |
| `sku_normalizado` | 341 | — | SKUs canónicos |
| `fatura` · `loja` · `despensa` · `lista_item` | dezenas | — | minúsculas |

**Implicação:** o `item` (núcleo das análises de preço) tem **centenas** de linhas, não milhões. Não há aqui nada que justifique desnormalização ou tabelas de agregação por performance. (O inventário automático do código *estimou* `item` em ~1M e alarmou sobre índices em falta — **falso**: a realidade são ~680 linhas, todas indexadas.)

## 2. Índices — estão lá

Verificado por `EXPLAIN` (todas as quentes usam índice, `rows≈1`):

- **`item`**: `idx_item_ean`, `idx_item_fatura`, `idx_item_sku`, PK. ✅
- **`catalogo_produto`**: `idx_ean`, `idx_marca` (novo, 054), `idx_fonte`, `idx_cat1`, `idx_catpath`, `uq_fonte_sku`, PK. ✅
- **`off_produto`**: PK = `ean` (lookup por EAN é instantâneo), `idx_off_marca`. ✅
- **`produto_ean`**: `uq_ean`. ✅  · **`sku_normalizado`**: `idx_sku_nome`, `idx_sku_categoria`, PK. ✅

**Não falta nenhum índice crítico.** O `idx_marca` que criámos hoje (054) era o único em falta num caminho quente (a lentidão da despensa).

## 3. O único *full-scan* que sobra: `catalogo_produto.nome LIKE '%…%'`

`EXPLAIN` dá `type=ALL, key=NENHUM, rows≈62272`. Onde corre:
- **`normaliza/resolverProduto.js`** (matching na **ingestão**): procura candidatos por token raro — várias passagens `LIKE '%token%'` por item de talão. Custo de ingestão (medido na aba **Custos**), não latência do utilizador.
- **`lista.js` `aplicarPrecoPorIrmao`** (estimativa de preço do "primo"): `nome LIKE '%família%'`. Já o **tirámos da despensa** (modo `leve`); na lista corre para poucos itens órfãos.

**Opções (por ordem de esforço):**
- **(a) FULLTEXT** em `catalogo_produto(nome, nome_pt)` + trocar os `LIKE` por `MATCH … AGAINST`. Mais rápido **e** mais correto (casa por palavra, não substring). Requer rever a semântica do matching (palavra vs. pedaço) e testar — não é trocar uma linha. **Recomendado quando o matching da ingestão for prioridade.**
- (b) Deixar como está: 62k linhas × ~50–100 ms por scan é tolerável fora do caminho do utilizador.

## 4. O esquema de fontes/EANs — a hipótese do dono, com números

**Onde vivem os EANs:**

| Fonte | EANs distintos | Tabela |
|---|---:|---|
| Catálogo (5 fontes: continente 19k, auchan 12k, lidl-fr 9,4k, mercadona 5k, mercadona-off 0,6k) | **42.577** | `catalogo_produto` (1 tabela, coluna `fonte`, `idx_ean`) |
| Open Food Facts | **22.477** | `off_produto` (PK=`ean`) |
| Fiches locais fundidas (produtos já vistos/identificados) | ~290 | `produto_ean` |
| Vistos em talão | 167 | `item.ean` |

**Sobreposição (a chave da questão):**
- Catálogo ∩ OFF = **5.924** EANs.
- **Só no OFF (invisível a quem só olha o catálogo): 21.045.**
- Só no catálogo (invisível a quem só olha o OFF): ~36.653.
- Dentro do catálogo, **3.519** EANs aparecem em ≥2 lojas (essa consolidação já é grátis: mesma tabela, `WHERE ean=?` traz todas as fontes).

**Diagnóstico:** o catálogo **já está unificado** (5 fontes numa tabela, indexado por EAN — não há fragmentação aí). A fragmentação real é **`catalogo_produto` ↔ `off_produto`**: dois universos com só 13% de sobreposição. Quem resolve um EAN tem de consultar **as duas** (mais a fiche local). **Não é problema de performance** (ambas indexadas por EAN, lookup instantâneo) — é de **completude**: um caminho que leia só uma fonte perde até 21k produtos.

**O que já está resolvido:** o resolvedor único `fundirFichaEan` (052) **já lê catálogo + OFF (dump e live) + fiche local + VLM** e funde campo-a-campo. Onde a ficha passa por ele, nenhuma fonte fica de fora.

**Onde está o risco de "fonte não consultada":** caminhos **ad-hoc** que consultam uma só tabela — p.ex. a **classificação ao vivo** (`resolverItensLista`) usa os `food_groups` do OFF **apenas se já existir fiche fundida** (`produto_ean.off_json`); um EAN que só existe em `off_produto` (dos 21k) não contribui com a sua categoria até ser fundido.

---

## 5. Recomendações (priorizadas)

### P0 — disciplina de código (resolve o "fonte não consultada", custo ~0) — ✅ FEITO (2026-06-13)
**Toda a resolução por EAN passa por `fundirFichaEan`** (já consulta tudo), em vez de queries soltas a uma tabela. Auditoria feita (grep de todas as queries por EAN a `catalogo_produto`/`off_produto`):
- O resolvedor `consultarOuGuardar`→`fundirFichaEan` já estava completo (catálogo+OFF dump+live+fiche+VLM).
- **Achado 1:** `marcaCatalogo`/`nomeCatalogoPt` em `produto.js` eram **código morto** (zero chamadores) → removidos.
- **Achado 2 (o "fonte não consultada" real):** `mestrePorEan` (usado no `/admin`) consultava o OFF **só para nutrição** — um EAN só-OFF (dos 21k) vinha sem nome/marca. **Corrigido:** consulta o OFF também quando falta nome e aproveita nome/marca/categoria.
- Sobra (sem impacto prático, anotado): a classificação ao vivo (`resolverItensLista`) usa `food_groups` do OFF só via fiche já fundida — mas os itens da lista/despensa são escaneados (têm fiche) ou digitados (sem EAN), por isso não há buraco real; encaminhá-la pelo OFF custaria queries no caminho quente (contra o trabalho de perf).

### P1 — VISTA do universo de EANs (a "tabela auxiliar com todos os EANs") — ✅ FEITO (migração 055)
A vista **`v_ean_universo`** (zero manutenção, sempre fresca): `UNION` dos EANs de `catalogo_produto`+`off_produto`+`produto_ean`+`item`, com flags `em_catalogo/em_off/em_fiche/em_talao`, `fontes_catalogo` e `tem_foto`. Números reais (o denominador único que faltava):

| | EANs |
|---|---:|
| **Universo total (distintos)** | **63.699** |
| só catálogo | 36.569 · só OFF **21.045** · ambos 5.837 |
| **com foto (denominador da vetorização)** | **32.631** / 42.577 no catálogo |

- Responde de uma vez ao "36k? 42k? 62k?" que confundia a vetorização: `SELECT COUNT(*) FROM v_ean_universo`.
- O MySQL 8 empurra o predicado pela vista (`WHERE ean=?` examina ~14 linhas), por isso também serve para localizar um EAN, não só o denominador.

Guardar também o *resolvido* (nome/marca/grupo canónico) por EAN seria estender o `produto_ean` (hoje só os ~290 vistos) a todo o universo — **materializar** em vez de vista. Maior esforço; decisão futura do dono.

### P2 — FULLTEXT em `catalogo_produto(nome, nome_pt)`
Só quando o matching da ingestão for prioridade (ver §3). Elimina o último *full-scan* e melhora a qualidade do match por palavra.

### Menores
- `loja`: o dedup usa `WHERE REPLACE(nif,'PT','')=?` (função em WHERE → não-indexável). Tabela tem 26 linhas → **irrelevante**; só anotar se a loja crescer.
- Limpeza: vários *full scans* de `sku_normalizado` (341 linhas) em `queries.js` por consulta — em memória, tabela minúscula, **inócuo**.

---

## Conclusão

Não há aqui um problema de performance de base de dados à espera de índices ou de tabelas de agregação — a BD é pequena e está bem indexada, e a lentidão sentida era algorítmica (já corrigida). O instinto sobre as fontes é **válido mas mal-atribuído**: o sintoma ("fontes não consultadas") é de **completude/código**, resolvido por (P0) encaminhar tudo pelo resolvedor único e (P1) uma vista do universo de EANs como denominador único. O redesenho pesado (unificar `off_produto` no catálogo) **não se justifica** — têm propósitos diferentes (o OFF traz nutrição/ingredientes/alergénios que o catálogo não tem) e a fusão por EAN já os junta quando preciso.

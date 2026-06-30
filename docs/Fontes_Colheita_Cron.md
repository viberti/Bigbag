# Fontes de dados, colheita e cron

> Inventário de TODAS as fontes do BigBag, como/quando se atualizam, e as regras duras da colheita. Consolidado em 2026-06-30 (auditoria de frescura + reposição/criação de crons pós-migração netcup). O CLAUDE.md tem só o ponteiro.

## Regras DURAS da colheita (dono)
1. **Incremental, UPSERT — NUNCA DELETE.** Toda a colheita faz `INSERT … ON DUPLICATE KEY UPDATE`: produtos novos entram, existentes atualizam, **produtos que saem da loja FICAM**, campos **enriquecidos** (nutrição, `product_type`, `nome_pt`, vetores) **preservam-se** (não estão no INSERT ou usam `COALESCE`). Nunca `DELETE`/`TRUNCATE`+recolher.
2. **Histórico de preço append-only.** Quando o preço muda (ou é novo), o anterior **não se perde** — vai para `catalogo_preco_hist` (`fonte, sku_fonte, ean, preco, moeda, preco_por_base, visto_em`). O preço "vivo" fica em `catalogo_produto.preco`; o histórico é a série.
3. **Guard 0-linhas.** Uma colheita que volta vazia (host bloqueou/mudou) **não apaga** os dados bons.

> **Auditoria de conformidade (2026-06-30):** 3 scripts violavam (1): `scrape_catalogo` e `scrape_mercadona` atualizavam o preço no lugar **sem** escrever o histórico; `carregar_nutripedia` fazia `DELETE`+INSERT. **Os três corrigidos** para UPSERT + histórico.

## Cron (crontab do user `dev` no netcup)
| Job | Quando | Script | Fontes |
|---|---|---|---|
| Monitor de remédios | **4/4h** | `monitorar_precos.mjs` | preço+estoque dos remédios monitorados |
| Continente | noturno (drip) | `scrape_catalogo.mjs continente` | PT |
| Backup BD | diário 04:10 | `backup_db.sh` | local 14d + R2 off-site 90d |
| Farmácias BR | Dom 00:00 (`refresh_farmacias`) | manifesto `fontes_farmacia.json` | ~16 redes (VTEX/RD/Panvel/Nissei/Araújo) |
| **VTEX BR (supermercados)** | **Sáb 01:00** | `refresh_fontes.mjs` → `fontes_vtex.json` | 25 supermercados |
| **Auchan** | **Ter 01:00** | `scrape_catalogo.mjs auchan` | PT |
| **Pingo Doce** | **Qua 01:00** | `scrape_catalogo.mjs pingodoce` | PT |
| **Lidl** | **Sex 02:00** | `scrape_catalogo.mjs lidl` | PT |
| **Mercadona** | **Qui 01:00** | `scrape_mercadona.mjs` | ES |
| **Nutripédia (carregador)** | **Dom 05:00** | `carregar_nutripedia.mjs` (cond. ao NDJSON) | PT nutrição |
| CMED | Qua 01:30 | `carregar_cmed.mjs` | identidade remédios BR |
| Captura programa lab | diário/semanal | `diag/captura_prod.mjs` | sinal de programa |

> As linhas a **negrito** foram **criadas em 2026-06-30** (não tinham cron — catálogos de supermercado 2-3 semanas velhos). As outras foram repostas com o crontab pós-migração.

## Motores de colheita (qual script por tipo de fonte)
- **VTEX** (BR supermercados + farmácias): `harvest_vtex.mjs` (orquestrado por `refresh_fontes.mjs`/`refresh_farmacias.mjs`). UPSERT + histórico nativos.
- **Sitemap PT** (auchan/continente/lidl/pingodoce): `scrape_catalogo.mjs <fonte>` (robots-compliant, sitemap+ficha). UPSERT + histórico (corrigido 2026-06-30).
- **Mercadona ES**: `scrape_mercadona.mjs` (API). UPSERT + histórico (corrigido).
- **Farmácias não-VTEX**: `harvest_raiadrogasil.mjs` (JSON-LD por EAN), `harvest_panvel.mjs` (BFF), `harvest_nissei.mjs`, `harvest_araujo.mjs` (schema.org PDP). Todas UPSERT + histórico.
- **JSON-LD genérico** (sitemap+schema.org): `harvest_jsonld.mjs`.
- **Geo-bloqueadas** (DPSP Pacheco/SP, Ultrafarma): `--proxy` (Lightsail SP). Ver CLAUDE.md.

## Casos especiais
- **Nutripédia (PT):** a RECOLHA corre **no PC** (Cloudflare 403 a IPs de datacenter) → produz NDJSON → `scp` p/ `/home/dev/nutripedia.ndjson`; o **carregador** (`carregar_nutripedia.mjs`, agendado Dom) lê-o e faz UPSERT. Sem NDJSON novo, o cron não faz nada.
- **off_full (~4,5 M OFF):** import ÚNICO (DuckDB do dump CSV); última importação ~15 jun. Re-importar é operação grande à parte, não cron.
- **Nutrição genérica** (`nutricao_taco` 591, `nutricao_fao` 100, `nutricao_usda` 6 514, `off_produto` 27 k): **referência estática** — carregadas uma vez, não precisam refresh.
- **ANVISA** (registos): manual (o servidor não alcança a ANVISA → baixar no PC + `scp` + `carregar_anvisa.mjs`).
- **base_local** (réplica do telefone): materializada por `build_base_local.mjs` (idempotente; inclui limpeza A/B + materialização do Nutri-Score) — correr após mudanças grandes.

## Como auditar a frescura (1 query)
Preço/scrape mais recente por fonte de catálogo:
```sql
SELECT c.fonte, COUNT(*) n, MAX(c.scraped_at) ult_scrape,
       (SELECT MAX(h.visto_em) FROM catalogo_preco_hist h WHERE h.fonte=c.fonte) ult_preco
  FROM catalogo_produto c GROUP BY c.fonte ORDER BY ult_preco DESC;
```
Imports em massa: `MAX(importado_em)` (off_full), `MAX(atualizado_em)` (anvisa_registro/base_local), `MAX(cmed_versao)` (medicamento).

> **Frescura medida (30 jun 2026):** farmácias/VTEX-BR/Continente frescos (≤3 d, nos crons); PT retalho (auchan/pingodoce/lidl/mercadona) estava 2-3 semanas velho → agora agendado; off_full 15 d (import único).

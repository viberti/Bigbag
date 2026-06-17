# Especificação de design — BigBag Dashboard de Gestão (`/dash`)

> **Para:** Claude designer (redesenhar/polir a UI).
> **Estado:** funcional mas visualmente cru ("horrível", palavras do dono). O objetivo deste documento é dar tudo o que precisas — estrutura, dados, tokens atuais, interações — para **melhorar o look & feel** sem partir a funcionalidade.
> **Snapshot fiel renderável:** [`dashboard_mockup.html`](dashboard_mockup.html) — abre no browser; reproduz os 4 ecrãs com dados reais e o estilo ATUAL. Edita esse ficheiro para propor o redesign.

---

## 1. Contexto

- **Superfície:** `/dash` (PWA React/Vite, `frontend/src/Dashboard.jsx` + `dashboard.css`). Surge no routing por path em `main.jsx`, ao lado de `/admin`, `/explorar`, `/v1`, `/v2`.
- **Público:** uso interno/gestão (single-user, o dono). **Desktop, denso, profissional** — não é consumer. Referência: Looker / Metabase.
- **Auth:** Bearer OIDC (Google/Zitadel) ou HTTP Basic — reusa o `adminApi`. Não é para mexeres.
- **Dados:** dois endpoints (já existem, não mudar o contrato):
  - `GET /api/admin/dashboard` → `{ fontes[], paises[], global{}, gerado_em }` (cacheado 20 min; ~20 s a frio, aquecido no arranque do servidor).
  - `GET /api/admin/custos?dias=N` → `{ total{}, geral{}, por_contexto[], por_modelo[], por_dia[] }`.
- **Idioma:** PT (Portugal). Moeda dos custos: USD (vem do OpenRouter). Números com separador de milhares PT (`4 511 942`).

## 2. Layout global (atual)

```
┌────────────┬──────────────────────────────────────────────┐
│  SIDEBAR   │  CONTEÚDO (uma página de cada vez)            │
│  (escura)  │  ┌─ <h1> título da página ──────────────┐    │
│            │  │                                        │    │
│ 📊 BigBag  │  │  [toolbar de filtros, se aplicável]    │    │
│  dashboard │  │                                        │    │
│            │  │  KPIs / tabela / cards / gráfico       │    │
│ 🌐 Global  │  │                                        │    │
│ 🗂️ Fontes  │  │                                        │    │
│ 🌍 Países  │  │                                        │    │
│ 💸 Custos  │  │                                        │    │
│            │  │                                        │    │
│ ─────────  │  └────────────────────────────────────────┘   │
│ ↻ recalc.  │                                                │
│ ← app      │                                                │
│ data de …  │                                                │
└────────────┴──────────────────────────────────────────────┘
```

- **Sidebar:** largura 218px, fixa (sticky, 100vh), fundo escuro `#233029`, texto `#c8dcc4`. Topo = marca "📊 BigBag · dashboard". Nav = 4 botões (item ativo a verde `#3f7a3f`). Rodapé = botão *↻ recalcular dados*, link *← voltar à app*, e a timestamp dos dados.
- **Conteúdo:** fundo claro `#eef1ec`, padding 24–30px. Cada item do menu troca a página inteira (estado `pagina`).
- **Estados:** `a calcular o panorama…` (loading), `Falha a carregar…` (erro). Os custos têm loading próprio.

## 3. Design tokens ATUAIS (a melhorar)

| Token | Valor atual |
|---|---|
| Fundo página | `#eef1ec` (verde-acinzentado claro) |
| Sidebar | `#233029` (verde muito escuro) / texto `#c8dcc4` |
| Acento primário | `#3f7a3f` (verde) · gradiente barras `#67b262→#3f7a3f` |
| Cards | branco `#fff`, borda `#e1e7de`, raio 11px, sombra mínima |
| Texto forte | `#243029` · muted `#6b7b6b` · hint `#9aa89a` |
| Destaque custo (USD) | coral `#c2553a` |
| Tipografia | `system-ui`; números KPI 28px/800; labels 12.5px |
| Bandeiras | emoji 🇵🇹🇪🇸🇫🇷🇦🇹🇧🇷🌍 |

Tudo isto é alterável. Mantém **densidade de informação** e **legibilidade desktop**.

## 4. As 4 telas

### 4.1 🌐 Visão global
Landing. Dois blocos de KPI cards (grid `auto-fit minmax(205px,1fr)`):
- **Bloco 1 (indicadores-chave):** Países cobertos · EANs únicos (global, dedup) [com sub-linha "OFF X + Y de retalho"] · EANs com nutrição (OFF) [sub "+ Z no catálogo"] · EANs no catálogo (retalho).
- **Bloco 2 (totais do sistema):** Fontes integradas · Produtos (todas as fontes) · Fotografias · Registos com nutrição.

Cada KPI card = número grande (28px) + label (12.5px) + sub-linha opcional (11px). Ver dados reais no §6.

### 4.2 🗂️ Fontes
- **Toolbar:** `<select>` país (Todos / 🇧🇷 BR / 🇵🇹 PT / …) · campo de pesquisa (fonte/plataforma) · contador "N fontes" · botão "⤓ CSV".
- **Tabela densa, ordenável** (clicar no cabeçalho ordena ↑/↓): colunas **Fonte · País · Plataforma · Produtos · EANs · Fotos (n + %) · Nutrição (n + %) · Ingredientes (n + %) · EANs únicos**. As colunas numéricas alinhadas à direita; os % a cinza pequeno ao lado do número.
- **Rodapé (tfoot):** linha de totais do âmbito filtrado.
- 31 linhas (29 fontes de retalho + `off_full` + `off_produto`). Ordenação default: Produtos ↓.

### 4.3 🌍 Países
Subtítulo + grid de **cards de país clicáveis** (`auto-fit minmax(210px,1fr)`). Cada card: bandeira + nome · "N fontes ativas" · "N EANs" · uma **barra** proporcional (vs o país com mais EANs). **Clicar num card → vai para Fontes filtradas por esse país.**

### 4.4 💸 Custos de IA
- **Toolbar:** "Período:" + botões 7 dias / 30 dias / ano.
- **3 KPI cards:** Gasto (no período) · Chamadas de IA · Gasto total (histórico).
- **Grid 2 colunas:**
  - Esquerda: tabela **Por operação** (operação · chamadas · custo · média) + tabela **Por modelo** (modelo · chamadas · custo).
  - Direita: **Evolução por dia** — lista de barras horizontais (data · barra · custo · nº chamadas).

> ⚠️ Nota do produto: a spec original pedia "custo por **fonte de dados**", mas os custos de IA **não** são atribuíveis às fontes de catálogo (que são raspadas/API, não IA). Implementámos **por operação** (= "tipo de operação") + **por modelo**. Mantém assim.

## 5. Briefing de melhoria (o que o designer deve resolver)

O esqueleto e os dados estão certos; falta **hierarquia visual e polish**. Pontos a atacar:
1. **Hierarquia & ritmo:** os KPI cards e tabelas estão "planos". Dar peso ao que importa (KPIs principais maiores; secundários menores). Espaçamento mais generoso e consistente.
2. **Sidebar:** tornar a marca/identidade mais limpa; ícones consistentes (estamos a usar emoji — considerar um set de ícones de linha coerente, ex. Tabler/Lucide). Estado ativo claro.
3. **Tabela de fontes (a peça central):** é densa e crua. Melhorar legibilidade — zebra/hover subtis, agrupar visualmente por país ou por plataforma, mini-barras nas colunas de cobertura (% nutrição/fotos) em vez de só texto, badges de plataforma com cor por tipo (VTEX/VipCommerce/Scrape/OFF). Sticky header.
4. **Cobertura como visual, não só números:** as % (fotos/nutrição/ingredientes) ficam melhor como mini-barras/donuts do que texto "9255 27%".
5. **Países:** os cards podem ganhar um mini-mapa ou ranking visual; a barra atual é básica.
6. **Custos:** o "gráfico por dia" é uma lista de barras CSS — pode passar a um gráfico de linha/área temporal a sério (a spec pede "evolução ao longo do tempo"). Distinguir custo vs nº chamadas.
7. **Coerência de cor:** definir uma paleta BI com 1 acento + neutros + cores semânticas (cobertura alta/baixa). Atualmente é tudo verde.
8. **Responsividade & dark mode** (opcional): é desktop, mas um dark mode de BI seria natural dada a sidebar escura.
9. **Empty/loading states** com mais cuidado (skeletons em vez de "a calcular…").

**Restrições:** manter as 4 páginas + a navegação lateral; manter os campos de dados e os endpoints; continuar denso e desktop-first; PT-PT.

## 6. Dados reais (para o mockup ser fiel) — snapshot 2026-06-17

**Global:** países cobertos **5** · EANs únicos global **4 655 232** (OFF 4 511 942 + 143 290 de retalho) · EANs c/ nutrição (OFF) **2 231 874** (+ 19 075 no catálogo) · EANs no catálogo **197 364**.
**Totais do sistema:** 31 fontes · ~5,0 M produtos · ~3,9 M fotos · ~2,26 M registos c/ nutrição.

**Países:** 🇧🇷 BR 18 fontes / 118 952 EANs · 🇵🇹 PT 5 / 46 471 · 🇫🇷 FR 2 / 17 997 · 🇪🇸 ES 3 / 11 485 · 🇦🇹 AT 1 / 7 751.

**Fontes (topo):** off_full (Global, Dump OFF) 4 511 942 prod / 4,5M EAN / 3,35M fotos / 2,23M nut · auchan (PT, Scrape) 34 438 / 34 436 / 27% nut / 19 255 únicos · mundial (BR, GraphQL) 24 812 / 24 433 / 9 161 únicos · gbarbosa (BR, VTEX) 24 748 / 10 643 únicos · continente (PT) 19 810 / 43% nut · paodeacucar (BR, Linx) 13 162 / 4 270 nut · nutripedia (PT, Transfer-state) 148 / 100% nut+ingred. (lista completa no mockup HTML.)

**Custos (30 dias):** gasto **$6,92** · 6 566 chamadas. Por operação: extracao_imagem $2,07 · classificar_tipo $1,01 · mestre $0,96 · canonicalizar $0,92 · traducao_corpus $0,82 · … Por modelo: gemini-2.5-flash $5,75 · gemini-2.5-flash-lite $0,40 · gemini-3.1-pro $0,27 · … Por dia: pico 07/06 $2,13 (2 944 chamadas).

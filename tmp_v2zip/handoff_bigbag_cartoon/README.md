# Handoff: BigBag — Novo design (tema "Cartoon")

> **Para:** desenvolvedor (Claude Code).
> **O que é:** o redesenho completo do BigBag num tema **claro, lúdico e acolhedor** ("cartoon"), com **protótipo navegável** de todas as telas. Substitui o tema escuro/chat anterior. **PT-BR.**

## Comece por aqui
| Ficheiro | O que é |
|---|---|
| `design/Prototipo_Cartoon.html` | **Protótipo navegável** (abrir no browser). Telemóvel com router próprio — clica para percorrer todas as telas. **Referência principal.** |
| `design/cartoon-ui.css` | **O sistema visual em código**: tokens (CSS vars) + classes de componente. Reusar tal e qual. |
| `design/cartoon-screens.js` | Router + markup de **todas as telas** (template strings JS vanilla). |
| `design/brand.js` | Mascote-saco (SVG) — `BIGBAG_MARK({size,chip})`. |
| `design/icons.js` | Set de ícones SVG — `ICON(name,{size,stroke,color})`. |
| `design/App_Cartoon.html` | Galeria estática das telas-chave lado a lado (visão geral rápida). |
| `snapshots/` | PNGs das telas principais. |

## Como implementar
1. **Adote `cartoon-ui.css`** como fonte da verdade visual (tokens + componentes). Mapeie as classes para os seus componentes (React/Vue/Svelte/SwiftUI…) mantendo nomes/valores.
2. As telas em `cartoon-screens.js` são **referência** (HTML por template strings, sem build). Recrie no seu stack ligando aos dados reais. O router (`go(id)`, objeto `S`) mostra a navegação e o estado de cada tela.
3. **Mobile-first**, telemóvel vertical (~390px). PT-BR, público 40–70 → alvos grandes, texto legível, formas redondas.

---

## Identidade visual (tema cartoon)
Mundo claro e quente: fundo creme-esverdeado, **formas redondas**, cartões com **borda branca 2px + sombra suave**, ilustração de fundo discreta (folhas/gotas), mascote-saco como anfitrião. Toques **anos 50** pontuais (separadores de mês, etiqueta de preço).

### Tokens (ver `cartoon-ui.css` para o conjunto completo)
| Token | Valor | Uso |
|---|---|---|
| `--cream` / `--cream-2` | `#eef3e2` / `#e7efd9` | Fundos |
| `--card` | `#fbfdf6` | Cartões (sempre com `border:2px solid #fff`) |
| `--ink` / `--ink-2` / `--ink-3` | `#3b4a30` / `#71805f` / `#9aa888` | Texto |
| `--leaf` / `--leaf-d` / `--leaf-soft` | `#5a9f57` / `#3f7a3f` / `#e0efd2` | Verde de marca / compras |
| `--amber` / `--amber-d` / `--amber-soft` | `#e6a23c` / `#c8851f` / `#f8ecd2` | **Despensa** + "atenção" |
| `--coral` / `--coral-soft` | `#e0734f` / `#f8e2d8` | Alerta / "alto" |
| `--sky` | `#cfe6e0` | Acento neutro (Gastos, Histórico) |
| **Fontes** | **Baloo 2** (display, 800) · **Plus Jakarta Sans** (texto, 400–800) |
| **Raios** | `--r 26` · `--r-sm 18` · pílula 999 |
| **Sombras** | `--sh 0 8px 22px rgba(70,110,55,.14)` · `--sh-sm 0 4px 12px …` |

### Regras de cor (importante)
- **Verde = lista/compras · Âmbar = despensa.** A despensa usa cabeçalho/itens/botão âmbar.
- **Nutri-Score**: pílula vertical oficial (cor por letra, fonte Arial branca) — só a letra do produto, ao lado do nome.
- **Réguas semáforo** (nutrição): 4 segmentos, destaca o nível (verde/amarelo/âmbar/coral) + palavra.

---

## Telas (no protótipo)
- **Início** — saudação + mascote, cartão grande "A minha lista", 5 ações redondas (**Consultar · Receitas · Comparar · Despensa · Gastos**), compras recentes (talão → detalhe), nav inferior.
- **Lista** (compartilhada com a família) — itens por categoria (separadores anos 50), **quem adicionou** (borda colorida por membro), **avatares de quem o produto serve**, **quantidade** (un/kg) ao lado dos controles − +, **etiqueta de preço retro** no topo, barra de adicionar **scan · voz · +** (o + revela escrever/habituais/catálogo), sugestões "está a acabar" (guardadas/ocultas).
- **Despensa** ("Tenho em casa") — em âmbar, botão âmbar "Escanear produto".
- **Consultar produto** — abre direto o scan; rodapé com 4 modos **Código · Produto · Voz · Texto**. Código = só cantos; Produto (foto) = quadrado completo. Lanterna discreta no canto. Mascote a espreitar.
- **Consultar por nome / Voz** — busca por texto com resultados; voz com mascote + balão de fala.
- **Ficha de produto** (consulta) — **a tela mais importante**: herói (foto + nome + Nutri-Score), **parecer "Para a Sue"** com selo (Adequado/Atenção), **réguas semáforo** (açúcar/gordura/saturados/sal/fibra/proteína), **Alternativas similares** (pílulas coloridas de nutrição + preço/kg), e acordeões **Ingredientes** (NOVA + cada ingrediente + alergénios), **Porquê dos selos**, **Como avaliamos** (limiares + fontes Open Food Facts).
- **Histórico** — produtos consultados (padrão da lista, sem categorias); ícone **comparar** no cabeçalho → modo seleção (cards ganham borda + ✓) → botão "Comparar N".
- **Comparar** — seleção de 2–6 (mesmos 4 modos da consulta) → resultado saúde-primeiro.
- **Minhas compras / Gastos** — talões com filtro por mercado (ordenado por nº de compras), separadores **por mês com total** (visual anos 50), card de gasto com **média mensal** e link "ver análise". **Análise de gastos**: total + média, barras dos meses, **"Em que gastou"** (categorias) antes de **"Onde gastou"** (lojas).
- **Talão (detalhe)** — loja + data + total + lista de produtos comprados (produto → ficha).
- **Perfil nutricional** — membro ativo + tags, avatares da família (trocar/adicionar), e **"Carregar perfil de saúde"**: enviar ficheiro **ou** colar texto (gerado por LLM) + Guardar.
- **Receitas** — sugestões para o perfil.

## Navegação & estado
- Router em `cartoon-screens.js`: objeto `S` (uma função por tela) + `go(id)`; pilha de "voltar" (`_back`), ✕/← e Backspace voltam.
- **Barra inferior** (4 abas): Início · Lista · Histórico · Perfil. Despensa/Gastos/etc. abrem da Início (têm botão **Voltar**).
- Telas de detalhe têm botão **Voltar** (pílula "← Voltar"); abas principais usam a nav.
- Estados principais: `cart` (Set de ids na lista), `picks` (quem apanhou cada item), `qty`, `histSel`/`histCompare`, `notasFilter`, `scanMode`, `fichaOpen` (acordeões), perfil ativo.

## Dados
Os dados das telas são **mock embutido** (em `cartoon-screens.js` e `data.js`). Ligar à fonte real (produtos, nutrição, talões, perfil). Forma típica: produto `{ nome, marca, nutri (por 100g), nutriScore, ingredientes[], alergénios[], alternativas[] }`; talão `{ loja, data, total, itens[] }`.

## Assets
- **Mascote / ícones:** SVG por código (`brand.js`, `icons.js`) — sem ficheiros externos.
- **Fontes:** Baloo 2 + Plus Jakarta Sans (Google Fonts).
- **Ilustração de fundo + cenas:** SVG inline nos ficheiros.

## Notas
- Tudo PT-BR.
- Preço é sempre **referência** (não exato/atualizado) — saúde é o foco.
- Nutri-Score segue o **padrão oficial** (cores/fonte).

# Processo — documentar telas do app e gerar um protótipo navegável

Guia reutilizável para, a partir de um app web a correr, produzir um **dossier de UI**
para entregar a um designer (ou ao "Claude designer"): screenshots reais das telas,
um mapa de navegação, observações de UX e um **protótipo HTML clicável** que simula o app.

Foi assim que se produziu `docs/UI_Telas_App.md` + `docs/ui/prototipo.html` (2026-06-13).
Os scripts de referência ficam em `docs/ui/_capturar_telas.mjs` e `docs/ui/_gerar_prototipo.mjs`.

> **Porquê isto e não um Figma:** os screenshots são o produto REAL (não uma maquete que
> diverge do código), a captura é repetível (corre-se de novo quando a UI muda), e o
> protótipo é um único ficheiro `.html` — o designer abre sem build, sem credenciais, sem
> servidor. O objetivo é dar-lhe o **modelo mental completo**: experimentar (protótipo) →
> entender (mapa) → ver o detalhe (catálogo) → saber onde focar (observações).

---

## Visão geral (4 entregáveis)

1. **Screenshots reais** — uma PNG por tela, em viewport de telemóvel, versionadas em `docs/ui/`.
2. **Catálogo de telas** — um `.md` com cada tela (imagem + para que serve + como se lá chega).
3. **Mapa de navegação** — a árvore/grafo de como as telas se ligam (ícones do topo, barra inferior, gestos, convergências).
4. **Protótipo navegável** — `prototipo.html` single-file: moldura de telemóvel + zonas clicáveis sobre os screenshots.

Os entregáveis 1 e 4 são gerados por script (repetíveis); 2 e 3 são escritos à mão a partir do que se observa.

---

## Passo 1 — Capturar as telas (Playwright, viewport de telemóvel)

**Ferramenta:** Playwright com um device móvel (`devices['iPhone 13']` → 390×844, DPR 3 → PNG 1170×1992).
Corre headless contra o **app em produção** (ou local) e tira uma screenshot por tela.

**Padrão que funcionou (lições incorporadas):**

- **Auth:** o app está atrás de HTTP Basic (`ENABLE_TEST_AUTH`). Passa `httpCredentials` no contexto.
  As credenciais ficam num ficheiro **gitignored** (`tmp_ui/.creds`, formato `user:pass`), nunca impressas
  nem versionadas. Lê de `TEST_USERS` do `.env` do servidor.
- **Uma tela = reload + sequência de cliques.** Não tentes fechar sheets para abrir a próxima (selectores
  diferentes, estado frágil). Volta sempre ao início (`page.goto`, `waitUntil:'networkidle'`) e refaz o caminho.
  Foi a correção do bug "fecharTudo não fechava a lista".
- **Espera generosa antes do screenshot.** Algumas telas fazem fetch lento (a Despensa demora ~1,9 s — o
  pipeline `resolverItensLista`). Sem espera suficiente apanhas "..." em vez do conteúdo. Usa ~2,2 s após o
  load + ~0,7–6,5 s conforme a tela.
- **Câmara/scanner precisa de câmara falsa.** Em headless não há câmara → erro na tela. Relança o Chromium com
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (e `permissions:['camera']` no contexto)
  para a tela de scan renderizar o seu chrome em vez do erro.

**Esqueleto** (ver `docs/ui/_capturar_telas.mjs` para o completo):

```js
import { chromium, devices } from 'playwright';
const [user, pass] = readFileSync('.creds','utf8').trim().split(':');
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  httpCredentials: { username: user, password: pass },
  permissions: ['camera'],
});
// tela(nome, ...passos): goto → espera → clica cada passo → screenshot
await tela('01_principal');
await tela('02_lista', '.listbtn');           // clica no ícone da lista
await tela('05_gastos', '.kebab', 'button:has-text("gastos")'); // 2 cliques
```

**Selectores:** prefere classes estáveis (`.kebab`, `.despbtn`) e `:has-text("…")` (robusto a i18n parcial,
ex. `has-text("erfil")` apanha "Perfil"). Se um clique falha, aborta essa tela e regista — não deixes o script
morrer a meio.

**Saída:** numera as PNGs (`01_…`, `02_…`) para ordem estável. Move as boas para `docs/ui/` e versiona-as.

---

## Passo 2 — Catálogo de telas (`.md` à mão)

Para cada tela: **a imagem**, **o que é / para que serve**, **como se lá chega** (que toque a abre).
Marca explicitamente os **candidatos a redesenho** (no BigBag, a tela de scan ganhou um bloco
"⚠️ CANDIDATA Nº 1" com os problemas concretos: 4 inputs, 2 objetivos misturados, 2 botões "Consultar"
idênticos, ecrã reusado sem mudança em 3 fluxos).

Fecha com uma secção **"Observações factuais"** — atrito objetivo que viste ao navegar (botão com cor errada,
tela lenta, item mal classificado, duas barras de navegação a competir). Factual, não opinião: o designer
decide, tu só apontas o que reparaste.

---

## Passo 3 — Mapa de navegação (`.md` à mão)

Uma árvore ASCII de **tudo o que liga a tudo**. Inclui:
- **Ícones do topo** (lista, despensa, kebab, avatar) e o que cada um abre.
- **Barra inferior** (Câmara→câmara nativa, Scanner→sheet, Comparar, Compras, Voz).
- **Gestos** (swipe = remover, long-press = …) e **rotas** (`/`, `/admin`, `/explorar`, `/diag`).
- **Convergências** — telas alcançáveis por vários caminhos (ex.: o scanner por ≥4 caminhos é o MESMO ecrã;
  a ficha de produto é um hub; o talão tem 4 entradas). Estas são pistas de ouro para o designer.

---

## Passo 4 — Protótipo navegável (`prototipo.html`, gerado)

Um **único ficheiro HTML** com os screenshots embebidos em base64 + zonas clicáveis (hotspots) por cima,
seguindo o mapa do Passo 3. Gerado por `docs/ui/_gerar_prototipo.mjs`.

**Anatomia do gerador** (o `T` é o coração):

```js
// id → { t:título, f:ficheiro, hs:[{x,y,w,h,to,lbl}] }   x,y,w,h em % (robusto à resolução)
const T = {
  principal: { t:'Principal (chat)', f:'01_principal.png', hs: [
    { x:46, y:1.5, w:13, h:5, to:'lista',    lbl:'Lista' },     // ícone do topo
    { x:20, y:92,  w:20, h:8, to:'scanner',  lbl:'Scanner' },   // tab da barra inferior
  ]},
  despensa: { t:'Despensa', f:'03_despensa.png', hs: [
    { x:4, y:90, w:92, h:9, to:'scanner', lbl:'Escanear produto' },
  ]},
};
const STUBS = { _camara:'Abre a CÂMARA NATIVA (não é tela da app).' }; // destinos não capturados
```

**Princípios:**
- **Hotspots em percentagem**, não em píxeis — sobrevivem a qualquer resolução de screenshot.
- **Destinos não capturados** (câmara nativa, rotas fora do lote) viram **STUBS**: ao clicar mostram um aviso
  em vez de partir. Honestidade sobre a fronteira do protótipo.
- **Navegabilidade garantida** independente dos hotspots: índice lateral de telas, botões Voltar/Início,
  toggle "mostrar zonas" (destaca a verde onde se pode clicar — essencial para o designer descobrir fluxos),
  e teclas ← / Backspace.
- **Single-file:** tudo (imagens, CSS, JS) embebido. O designer faz duplo-clique e funciona — sem servidor,
  build, ou credenciais. Custo: ~3 MB para 11 telas (aceitável; é um artefacto de documentação).

**Validação:** abrir o ficheiro em Playwright, clicar uma zona, confirmar que o título muda
(`test_proto.mjs` fez exatamente isto: "clicou despensa: true · título agora: Despensa").

---

## Reutilizar noutro app / noutra sessão

1. `npm i playwright` numa pasta temporária (`tmp_ui/`, gitignored); `npx playwright install chromium`.
2. Copia `docs/ui/_capturar_telas.mjs` e `_gerar_prototipo.mjs` como ponto de partida.
3. Ajusta a `URL`, as credenciais (`.creds`), e a lista de `tela(...)` aos ecrãs e selectores do novo app.
4. Corre a captura → revê as PNGs → move as boas para `docs/ui/`.
5. Ajusta o `T` do gerador (telas + hotspots em %, lê o mapa de navegação) e corre-o.
6. Escreve à mão o catálogo + mapa + observações.
7. Commit: PNGs + `prototipo.html` + os dois scripts `_*.mjs` + o `.md`. O `.creds` e o `tmp_ui/` ficam fora.

**Higiene:** os scripts vivem em `tmp_ui/` (descartável) durante o trabalho; só as **versões limpas** (`_*.mjs`,
sem segredos) e os artefactos finais entram no repo. Credenciais nunca impressas nem versionadas.

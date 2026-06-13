# BigBag — Brief de design: revisão de usabilidade + uniformização das telas

> **Para:** designer (humano ou assistente de design).
> **Pedido em uma frase:** revê a **usabilidade** do app e propõe um **design uniforme** para todas as telas — hoje elas cresceram organicamente e divergem entre si.

---

## 1. O que é o BigBag

App pessoal (PWA mobile-first) de **histórico de preços de compras**: a pessoa fotografa o talão/fatura, o app lê e guarda os itens, e depois responde a perguntas ("onde está mais barato?", "quanto gastei?") por texto ou **nota de voz**. Tem também uma **lista de compras partilhada** (vários membros da casa, cada um com a sua cor), um **scanner de código de barras**, uma **despensa** (inventário do que se tem em casa) e um **perfil nutricional** por membro.

- **Idioma:** tudo em **PT-BR**, tratamento por "você".
- **Plataforma:** PWA, **mobile-first** (desenhado para telemóvel; capturas em iPhone 13, 390×844). Usa-se sobretudo no telefone, muitas vezes **dentro do supermercado** (uma mão, pressa, luz variável).
- **Tema:** escuro, esverdeado (verde-garrafa). Cores por membro aparecem na lista/despensa.
- **Há 3 superfícies** (por path): a **app do utilizador** (`/`, o foco deste brief), um painel de **operador** (`/admin`, desktop) e um **explorador** (`/explorar`, desktop). **Este brief é só a app do utilizador.**

---

## 2. O que vem neste pacote

| Ficheiro | O que é |
|---|---|
| **`prototipo.html`** | 🖱️ **Comece por aqui.** Protótipo **navegável** — abre no browser (duplo-clique, sem servidor) e clica como no telefone. Liga **"mostrar zonas"** para ver onde se pode tocar. Tem índice lateral de telas e botão Voltar/Início. As imagens são os screenshots **reais** de produção. |
| **`UI_Telas_App.md`** | **Catálogo das 12 telas** (cada uma: imagem + para que serve + como se lá chega) + um **Mapa de navegação** (como tudo se liga) + observações que já fizemos. |
| **`ui/*.png`** | Os 12 screenshots reais, em alta resolução. |

Sugestão de leitura: **navegue o protótipo primeiro** (sentir o app) → depois o catálogo/mapa (entender a estrutura) → depois as observações abaixo.

---

## 3. O que pedimos (dois objetivos)

### A) Usabilidade — encontrar e priorizar o atrito
Percorra cada tela e cada fluxo principal e aponte problemas de usabilidade, do mais grave ao mais leve. Pense em quem usa **no supermercado, com uma mão, com pressa**. Em particular:

- **Fluxos principais:** (1) capturar um talão → ver os itens; (2) fazer uma pergunta por **voz**; (3) montar a **lista de compras** e usá-la a comprar; (4) **escanear** um produto na prateleira para ver a ficha; (5) gerir a **despensa**.
- **Navegação:** o app tem **duas barras a competir** — ícones no topo (lista, despensa, menu ⋮, conta) **e** uma barra de ações em baixo (Câmara, Scanner, Comparar, Compras, Voz). Isto é claro? O que devia estar onde? O menu **⋮ (kebab)** mistura coisas de naturezas diferentes (ações, definições, diagnóstico) — vale reorganizar.
- **Hierarquia e leitura:** o que salta primeiro à vista em cada tela é o mais importante? Há ecrãs densos demais?
- **Tela de SCAN / Consultar produto — candidata nº 1 a redesenho** (ver secção própria no catálogo): hoje está confusa — junta vários campos de entrada e dois objetivos diferentes (escanear código vs. consultar manualmente) no mesmo ecrã, com botões repetidos. Gostaríamos de uma proposta de redesenho desta tela.
- **Estados:** vazio, a carregar, erro, offline. (Ex.: a Despensa demora ~2s a carregar e mostra "…" — como tornar a espera menos seca?)
- **Toque/alvos:** tamanho dos alvos, gestos (swipe para remover na lista/despensa), feedback de ação.

**Entregável A:** lista priorizada de problemas (severidade alta/média/baixa), cada um com: tela, o problema, porquê custa ao utilizador, e uma sugestão de correção. O redesenho da tela de scan pode vir como mockup.

### B) Uniformizar o design — uma linguagem visual única
As telas foram nascendo em alturas diferentes e **não partilham um sistema** coerente. Queremos que passem a parecer **a mesma app**. Defina/proponha:

- **Sistema visual:** paleta (e uso das cores de membro), tipografia (escala e pesos), espaçamentos, raios, sombras, ícones (estilo único).
- **Componentes recorrentes** padronizados: cabeçalho de sheet (e o botão de fechar — hoje varia), cartões (item de lista, item de despensa, talão, ficha de produto), botões (primário/secundário — **há um botão que devia ser âmbar e está verde**, e botões "Consultar" duplicados na tela de scan), chips, campos de entrada, barra de navegação.
- **Padrões de layout:** como abrem as "sheets" (folhas deslizantes), onde fica o título, onde fica a ação principal.
- **Consistência de conteúdo visual:** como se mostra **marca vs. nome** do produto (hoje às vezes a marca aparece colada à loja), tamanho/preço, secções/categorias.

**Entregável B:** um mini **guia de estilo** (tokens + componentes) e a aplicação dele a **2–3 telas-chave** redesenhadas (sugerimos: Principal/chat, Lista de compras, e a Ficha de produto ou o Scanner), para servir de referência ao resto.

---

## 4. O que já notámos (valide, não trate como exaustivo)

Achados nossos ao documentar — confirme, descarte ou aprofunde:
1. **Duas barras de navegação** (topo + base) competem pela atenção.
2. **Menu ⋮ (kebab)** mistura naturezas: ações, definições e até "diagnóstico do scanner".
3. **Tela de scan confusa** (a tal candidata nº 1): 2 objetivos + vários campos + botões repetidos no mesmo ecrã, reutilizado sem mudança em 3 contextos.
4. **Botão "Escanear produto"** na despensa está **verde** quando devia ser **âmbar** (a despensa usa âmbar como cor própria, para não confundir com a lista).
5. **Botão de fechar das sheets** não é consistente entre telas.
6. **Marca colada à loja / nome** em alguns cartões de produto.
7. **Despensa lenta** (~2s) com estado de loading pobre ("…").
8. **Lista grande na despensa** — ao adicionar um item, ele aparece com borda colorida e a tela rola até ele (bom — manter/uniformizar este tipo de feedback).

## 5. Ignore isto (não é design — é dado/backend, ou já corrigido)
Os screenshots são de **produção real**, então aparecem quirks de **dados** que **não** são tarefa de design:
- Alguns produtos com **nome em espanhol** (vêm de catálogos ES) ou classificação de categoria estranha — é normalização de dados, tratada do nosso lado (ex.: "Sésamo" que estava em "Frutas" já foi corrigido).
- Valores/preços específicos, nomes de lojas, datas — dados reais variáveis.
Foque-se na **interface e na experiência**, não no conteúdo dos dados.

## 6. Restrições a respeitar
- **Mobile-first** e PWA (sem chrome de browser; instala-se no ecrã inicial). Funciona **offline** em parte (lista, scan).
- **PT-BR**, "você". Nada de texto fixo só em código — mas isso é nosso; você só precisa de manter os rótulos em PT-BR nas propostas.
- Manter o **espírito** atual (escuro, esverdeado, próximo, informal) — pode evoluí-lo, não precisa de o deitar fora.
- Uma mão, pressa, supermercado: **simplicidade e alvos grandes** ganham a "beleza" densa.

---

**Resumo do pedido:** (A) uma auditoria de usabilidade priorizada, com foco no redesenho da tela de scan; (B) um sistema visual único aplicado a 2–3 telas-chave como referência. Comece pelo `prototipo.html`.

# BigBag — Catálogo visual das telas (app do utilizador)

*Capturas reais em viewport de telemóvel (iPhone 13, 390×844) da app em produção `bigbag.hal9klabs.com`, v0.0.153.0, com a conta do dono (perfil "Sue" ativo). Geradas por Playwright (`tmp_ui/cap*.mjs`). Objetivo: documentação sólida da UI + base para o **designer** propor melhorias.*

> **Três superfícies** (routing por path): **`/`** app do utilizador (este doc), **`/admin`** operador (desktop), **`/explorar`** comprador (desktop). Aqui só a app do utilizador — a PWA mobile-first.

A app é um **chat** com uma **barra de ações inferior** e ícones de topo que abrem **sheets** (folhas deslizantes). Tudo o que segue são sheets sobre a tela principal.

---

## 1. Principal (chat) · `01_principal.png`
![principal](ui/01_principal.png)

O ecrã-casa. Topo: marca + versão · ícone **lista** (verde) · ícone **despensa** (âmbar, com pílula de contagem) · kebab (⋮) · avatar. Corpo: histórico de conversa estilo WhatsApp — cada talão lido vira uma "bolha" (loja, data, total, nº itens). **Chips de sugestão** ("Tendência de preços", "Onde está mais barato", "Minha última nota"). Barra de input "Escreva uma pergunta…". **Tab bar inferior:** Câmara · Scanner · Comparar · Compras · **Voz** (destaque verde).

## 2. Lista de compras (vazia) · `02_lista.png`
![lista](ui/02_lista.png)
Estado vazio com call-to-action **"✨ Começar por mim (4)"** (pré-preenche pelo ritmo de compra). Linha de adição (ordenar · pessoal · campo "Adicionar produto…" · scan · voz). **Total estimado** + "Esvaziar lista". *(Com itens, agrupa por secção — ver o formato na despensa, idêntico.)*

## 3. Despensa · `03_despensa.png`
![despensa](ui/03_despensa.png)
"Tenho em casa" — lista paralela e independente da de compras. Título com contagem (**· 51**). Secções em **âmbar** (FRUTAS E VEGETAIS, CONSERVAS, PEIXE E MARISCO…). Cada item: **nome** + **marca** (cinza) + linha de baixo `tamanho · €preço · online/estimado · Val. data` (validade em âmbar). Remover = **swipe**; tocar = ficha. Rodapé: **"Escanear produto"** (entrada única da despensa).

## 4. Menu (kebab ⋮) · `04_menu.png`
![menu](ui/04_menu.png)
Captura: Digitalizar documento · Galeria (várias) · Arquivo/PDF — separador — Consultar produto · Meus gastos · Produtos por identificar · Diagnóstico do scanner.

## 5. Meus gastos · `05_gastos.png`
![gastos](ui/05_gastos.png)
Cards: Este mês (Junho 338,23 €) · Mês anterior (Maio) · Média mensal · variação (▼31% gastou menos). Gráfico de barras por mês. "Onde gastou este mês" (barras por loja).

## 6. Conta (avatar) · `06_conta.png`
![conta](ui/06_conta.png)
Menu curto: Perfil nutricional · Nova conversa · Sair.

## 7. Perfil nutricional · `07_perfil.png`
![perfil](ui/07_perfil.png)
Carregar/colar o perfil (gerado por LLM) de um **membro** ("Sue"). Fica ativo para as avaliações personalizadas dos produtos.

## 8. Comparar produtos · `08_comparar.png`
![comparar](ui/08_comparar.png)
Scanner ao vivo (moldura) para ler 2–6 produtos e comparar lado a lado. Campo manual de EAN. *(Câmara preta = captura headless sem câmara real.)*

## 9. Scanner / Consultar produto · `09_scanner.png`
![scanner](ui/09_scanner.png)
Lê um código de barras → abre a ficha do produto. *(Idem câmara headless.)*

## 10. Ficha de produto · `11_ficha.png`
![ficha](ui/11_ficha.png)
A tela mais rica. Imagem + nome · **parecer personalizado "Para Sue"** com selo (Adequado) e texto · "Análise completa" · **Nutri-Score** (A…E) · **réguas nutricionais** (açúcares/gordura/saturados com barra e rótulo baixo/alto). Factual, não-clínico.

## 11. Voz · `12_voz.png`
![voz](ui/12_voz.png)
Captura de nota de voz (pergunta ou ditado para a lista).

---

## Observações factuais (input para o designer — não são decisões)

**Sistema visual.** Tema escuro verde-floresta; **verde** = lista/compras, **âmbar** = despensa (introduzido como teste para distinguir as duas listas). Cantos arredondados, bolhas de chat, sheets com handle de arrastar.

**Inconsistências/achados observados nesta captura:**
1. **Botão "Escanear produto" da despensa está VERDE**, não âmbar como o resto da despensa — o CSS `.pid-enviar-btn` (verde) sobrepõe-se ao `.desp-add` (âmbar). Quebra a linguagem de cor da superfície.
2. **Despensa lenta a abrir**: `GET /despensa` ~1,9 s para 51 itens (reutiliza todo o pipeline de enriquecimento da lista) → ~2 s de estado "…" antes do conteúdo. Falta um *skeleton*/loading melhor, ou caching.
3. **Classificação visível ao utilizador**: "Sésamo Ajonjolí" aparece em **Frutas e Vegetais** (devia ser mercearia/temperos).
4. **Nomes não traduzidos / em espanhol**: "Ajonjolí", "Sushi Rice", "Filetes de Cavala Del Sur **Contenido Reducido En Sal En Azeite**" (nome longo, corta em 2 linhas).
5. **Marca com loja colada**: "Campo Largo, Lidl".
6. **Menu kebab mistura naturezas**: ações de captura (digitalizar/galeria/PDF) + navegação (gastos, por identificar) + ferramenta (diagnóstico) — candidato a reorganização.
7. **Duas barras de navegação** competem pela atenção: ícones de topo (lista/despensa/kebab/avatar) + tab bar inferior (câmara/scanner/comparar/compras/voz). Há sobreposição funcional (scanner no topo via lista e em baixo via tab).

**Pontos fortes a preservar:** a ficha de produto (parecer personalizado + Nutri-Score + réguas) é densa mas legível; o gesto de swipe unificado (lista e despensa); a cor âmbar como distinção de superfície; o estado-vazio acionável da lista ("Começar por mim").

*Telas em falta neste lote (a capturar depois): lista COM itens (não capturada para não alterar dados reais), câmara inteligente, scanner a detetar, `/admin` e `/explorar`.*

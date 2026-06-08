# Handoff: BigBag — Ícone da app ("Spotlight")

## Overview
Novo **ícone da app** BigBag — direção **"Spotlight"**: o saco-mascote (com carinha + *spark*) iluminado por um **holofote verde** sobre um fundo escuro com profundidade. Substitui o ícone anterior (saco branco sobre verde chapado), que se confundia com outros ícones e ficava perto do verde do WhatsApp. O tile escuro-com-brilho **destaca-se** entre os ícones coloridos do ecrã inicial.

## Conteúdo (tudo pronto a usar)
```
icon/
  bigbag-icon.svg            ← master vetorial (tile arredondado, 1024)
  png/
    bigbag-1024.png          ← loja / marketing
    bigbag-512.png           ← Play Store
    bigbag-192.png  180  120 96  72  48   ← web/PWA/legacy
  adaptive/                  ← Android adaptive icon
    foreground.svg / foreground-432.png   ← só o saco (safe zone, transparente)
    background.svg / background-432.png    ← fundo holofote (full-bleed)
```

## Especificação visual
- **Fundo (tile):** degradê radial verde — holofote do centro-topo para fora:
  `#1b8f63` (centro) → `#0c3b32` (55%) → `#06201d` (bordas), com um realce radial `rgba(70,222,150,.85)→0` por cima (o "holofote").
- **Saco (mascote):** corpo `#eafff3`, dobra/asas `#bdf3d4`, traços do rosto `#0a3b2c`, **spark** branco `#ffffff`.
- **Forma:** rounded-square. SVG master usa `rx≈23%` (em viewBox 100). Para iOS, o sistema aplica o *squircle* — usar `png/bigbag-1024.png` (já com cantos) ou o quadrado completo conforme a *toolchain*.
- **Sombra/profundidade:** vem do degradê + holofote (não usa sombra externa — o SO compõe a sua).

## iOS
- App icon: **1024×1024** sem transparência → usar `png/bigbag-1024.png`. O Xcode/Asset Catalog gera os restantes tamanhos. (Se a tua pipeline pedir tamanhos soltos, estão em `png/`.)

## Android (adaptive icon)
- **Foreground:** `adaptive/foreground.svg` (ou `foreground-432.png`) — **só o saco**, já recuado para a *safe zone* (~66% central), fundo transparente.
- **Background:** `adaptive/background.svg` (ou `background-432.png`) — o **holofote** full-bleed.
- Montar em `mipmap-anydpi-v26/ic_launcher.xml`:
  ```xml
  <adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_foreground"/>
  </adaptive-icon>
  ```
  (Para o tema monocromático do Android 13+, o `foreground` serve de base; opcionalmente fornecer uma versão a 1 cor.)
- Preferir os **SVG** como fonte e exportar os densitários (mdpi→xxxhdpi) na build, ou usar o Image Asset Studio com o `foreground.svg`/`background.svg`.

## Web / PWA
- `192` e `512` para o `manifest.json` (`icons`), `180` para `apple-touch-icon`, `48/72/96/120` para *favicons*/legacy.
- `theme-color` sugerido: `#0c3b32` (ou `#06201d`).

## Reproduzir / ajustar
- Master programático em `appicon.js` (raiz do projeto de design): `APPICON('spotlight', size)` devolve o SVG. Variantes disponíveis: `emerald`, `spotlight` (esta), `cream`/outline, `night`. Trocar a paleta no objeto da variante.
- Mantém a regra: **uma forma reconhecível (saco + carinha)** + **profundidade no fundo** + **spark**. Não achatar o fundo (era o problema do ícone antigo).

## Files
`icon/` — todos os assets acima (SVG master, PNGs, adaptive).
`preview/` — `AppIcon.html`: as 4 direções exploradas + a recomendada em vários tamanhos + comparação **antes/depois** no ecrã inicial. (Referência de design; precisa de `appicon.js`.)

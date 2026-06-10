# Plano — Auditoria de UX/Design da PWA (Claude como revisor)

**Estado:** planeado, a executar "daqui a pouco". Objetivo: o Claude faz uma revisão
de **usabilidade + design** dos ecrãs da PWA e propõe correções concretas; aplica os
*quick wins* aprovados (tem o código) e deixa as decisões maiores para o dono.

## Alcance
- **Faz:** auditoria heurística (Nielsen + boas práticas mobile) — hierarquia visual,
  consistência, *affordances*, profundidade de navegação, alvos de toque, contraste/
  acessibilidade, estados (vazio/erro/a-carregar), microcópia.
- **Não substitui:** o olho subjetivo/autoral de um designer humano (estética de
  portfólio, identidade visual original). Esse continua a valer — esta auditoria é o
  rigor sistemático que complementa.

## Método
1. Base: os ecrãs já vistos/capturados (ver `Bigbag_Telas.html` + `shots/`) e o
   mapa de navegação. App em v0.0.95.4.
2. Percorrer **por ecrã** e **por princípio**. Cada achado:
   `[severidade alta/média/baixa] · ecrã · princípio · o quê · porquê · correção sugerida · (quick-win? implementável já)`.
3. Separar **quick wins** (CSS/layout/cópia — aplico já) de **mudanças estruturais**
   (decisão do dono).
4. **Saída:** `design/review/Auditoria_UX.md` (achados priorizados) + commits dos
   quick wins aprovados.

## Modo de execução (escolher na hora)
- **Solo inline** (default): sólido, rápido, barato.
- **Multi-agente** (só se pedido explicitamente — consome muitos tokens): várias
  lentes (usabilidade · acessibilidade · visual · consistência) que se verificam
  entre si, depois síntese.

## Observações-semente (já dos ecrãs reais)
1. **Inconsistência de chips** — a *marca* é chip **verde** (= cor do preço/accent) e o
   *tamanho* é cinza neutro. O verde da marca compete com o preço; provavelmente ambos
   neutros, deixando o verde só para o **preço**. *(quick win)*
2. **Rodapé com 5 ações**, duas de "capturar" (📷 câmara inteligente + ▮▮ scanner de
   barras) — ambiguidade de descoberta (quando uso qual?). Rever rótulos/agrupamento.
3. **Densidade do detalhe da compra** — nome + chip marca + chip tamanho + sub-linha
   qtd + preço a competir numa linha. Rever ritmo/espaçamento/peso tipográfico.

## A confirmar antes/durante
- Ter os screenshots finais (limpos, v0.0.95.4) em `shots/` ajuda a auditoria visual.
- Se houver acesso vivo (login designer), validar interações/transições reais.

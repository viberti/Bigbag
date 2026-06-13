# Visão multi-país (Europa) e a arquitetura de duas camadas

*Decisão de direção (dono, 2026-06-13): o app não é só para Portugal. Se sair do laboratório, utilizadores de outros países europeus vão querê-lo. Este doc fixa a arquitetura que torna isso viável sem reescrever tudo, e o que fazer (e não fazer) agora.*

## A ideia central: separar IDENTIDADE de PREÇO+LOCALE

Um produto tem uma **identidade universal** (o EAN/GTIN da Nutella 400 g é o mesmo em PT, ES, FR) e uma **realidade local** (preço, loja, idioma). Separar estas duas coisas é o que torna o app multi-país sem o reescrever:

### Camada 1 — IDENTIDADE (universal, partilhada, keyed-by-EAN)
Nome canónico, marca, nutrição, ingredientes, imagem + vetores, classificação, ligações cross-loja/cross-país. **Construída uma vez, beneficia todos os países.** Cada país que raspamos *enriquece a mesma camada* — um espanhol a escanear Nutella melhora a Nutella que o português vê.
- **Flywheel:** mais países → mais dados de identidade → melhor para todos.
- Já assenta em coisas agnósticas ao país: **EAN** (chave), **Open Food Facts** (base pan-europeia multilíngue por EAN), **match por imagem** (a aparência é universal), `fonte` tag.
- A OFF prova que uma base de produtos europeia por EAN funciona; o nosso diferencial é a camada que ela não tem: **preço real (talões) + personalização**.

### Camada 2 — PREÇO + LOCALE (por país, parametrizável)
Talões (factos de preço, por utilizador/país), conjunto de lojas relevantes, idioma de exibição, rótulos de secção, formato de talão/identificação fiscal. **Parametrizada pelo país/locale do utilizador**, não fixa a PT.

**Regra de ouro:** investir a fundo na Camada 1 (é tudo reaproveitável, sem locale) e manter a Camada 2 **parametrizável** em vez de PT-cravada.

## O que já está pronto vs. PT-cravado

**Agnóstico / pronto:** EAN, OFF (`consultarOFF`), match por imagem, `fonte` tag, i18n da UI (`t()`, traduzir = juntar dicionário), moeda (PT/ES/FR são todos Euro), perfis/membros.

**PT-cravado — virar *locale-aware* quando se lhes tocar (não antes):**
- **Prompts do LLM** pedem "PT-BR + você" → parametrizar pelo locale do utilizador.
- **Resolvedor de nome PT-first** (`fichaEan`/Conceito) → **país-do-utilizador-first** (catálogo do país > traduzido; marcas nunca se traduzem).
- **Rótulos de secção** PT → os ids de grupo (`grupoDe`) já são neutros; só as *labels* traduzem (i18n trata).
- **Leitura de talão** assume cadeias e NIF PT → ES/FR têm cadeias e formatos fiscais próprios.

Nenhum é difícil isolado; o caro seria descobrir tarde que estão espalhados. Por isso: **locale-ready, não locale-completo.**

## Implicação para as fontes de catálogo

Escolher fontes de **gama completa com marcas nacionais/internacionais** (Auchan/Alcampo, Carrefour, Continente) e **não** as de marca-própria pesada. Medição real (2026-06-13): dos 5.013 EANs do Mercadona (ES, quase todo Hacendado) só **2%** existem no catálogo PT — private-label não atravessa fronteiras. O **Alcampo** (Auchan ES, mesma plataforma Demandware) deve ter sobreposição muito maior, porque carrega as mesmas marcas internacionais. Ver `Analise_Fontes_Normalizacao.md`.

## Postura pragmática (enquanto é laboratório, utilizador único)

1. **NÃO construir a maquinaria multi-país agora** — prematuro, abranda.
2. **Continuar a alimentar a Camada 1** (EAN, OFF, imagem, ligações cross-loja) — já é o que se faz; 100% reaproveitável.
3. **Parar de cravar PT mais fundo**: quando se mexer num prompt, no resolvedor de nome ou na leitura de talão, deixá-los a receber um `locale`/`país` (mesmo que o valor seja sempre `pt-PT` por agora).
4. **País nº 2 óbvio = Espanha** (Euro, fronteira de marcas partilhada com PT, Alcampo/Mercadona já em parte). Quando se sair do laboratório, arranca-se a Camada 2 para esse locale.

## Estado relacionado
- Match cross-loja por imagem+metadados (PD→catálogo): ver `match-por-imagem-estado` (memória) e `catalogo_match`. É o motor que liga o mesmo produto entre lojas/países sem depender da escrita.
- Vertical Espanha+Mercadona: `Vertical_Espanha_Mercadona.md` (ideia de produto anterior, agora subsumida nesta visão mais ampla).

# Nutrição canónica para commodities — design (1)

> **Problema a resolver:** produtos que são **a mesma comida genérica** (ovos de galinha, leite meio-gordo, açúcar, farinha, arroz, carnes/peixes frescos) deviam ter **UMA** nutrição e **UMA** nota Nutri-Score — mas têm nota dispersa porque usamos a nutrição **por-EAN de cada marca** (com lacunas e erros). Decisão do dono (2026-06-30): *"todos os ovos do mesmo animal deviam ter o mesmo Nutri-Score, salvo qualificador no nome"*.
>
> Complementa o fix **(2)** já feito (açúcar em falta = 0 p/ alimento sem açúcar): o (2) faz os ovos **terem** nota; o (1) faz **todos terem a MESMA** nota. Ainda **não implementado** — este é o desenho.

## 1. Evidência (medida)
Depois do (2), os **ovos** (familia `ovos`, 328 produtos) têm nota mas **dispersa de D(35) a A(85)** — a mesma comida, notas diferentes, por variação dos dados por-marca. O mesmo padrão em `leite meio-gordo`, `gouda`, etc. (auditoria por nome: ~131 grupos com gap ≥35). A nutrição canónica do ovo (TACO *"Ovo, de galinha, inteiro, cru"*: 143 kcal, 8,9 g gord, 2,6 g sat, 0,42 g sal, açúcar≈0) dá **A (~80)** — a nota correta a que todos deviam convergir.

## 2. Princípio
Uma **commodity** (alimento genérico de perfil fixo) tem um **perfil nutricional canónico**. Para esses produtos, a nutrição **autoritativa** (TACO > FAO > USDA — o matcher `nutricaoGenerica` em `normaliza/taco.js` que já existe) deve **vencer** a nutrição retail por-marca → uma nutrição → uma nota. **Não** é assumir que todas as marcas são iguais; é reconhecer que para uma commodity SEM qualificador, a variação entre marcas é **ruído de dados**, não diferença real.

## 3. Desenho
### 3.1 Que famílias são commodity (tabela curada, versionada + data + dono)
Só onde um único perfil canónico é VÁLIDO: `ovos`, `leite`*, `arroz`, `massa`*, `farinha_acucar`, `leguminosas`, carnes frescas (`frango`/`boi`/`porco`/`peru`/`pato`/`cordeiro`), peixes frescos (`salmao`/`bacalhau`/…), `azeite`/`oleo`. *NÃO* commodity: doces, bolachas, refrigerantes, pratos preparados, charcutaria (receitas variam de marca p/ marca).
> (*) leite e massa têm **variantes de perfil** (meio-gordo/magro/gordo; com ovo/integral) — a chave canónica inclui o qualificador (§3.3).

### 3.2 Mapa família → descritor canónico
Por família, o descritor TACO/USDA a usar (ex.: `ovos` → "Ovo, de galinha, inteiro, cru"; `arroz` → "Arroz, integral/polido, cozido"; `frango` → "Frango, peito, sem pele, cru"). Curado, num ficheiro de dados (`data/nutricao_canonica.json`), revisto pelo dono. A nutrição vem da `nutricao_taco`/USDA (já na BD).

### 3.3 Exceção do QUALIFICADOR no nome (a parte fina)
A nutrição canónica só se aplica ao produto **simples**. Se o nome traz um qualificador que muda o perfil, usa-se a variante específica OU mantém-se a retail:
- **Tipo/teor:** leite *meio-gordo* vs *magro* vs *gordo*; arroz *integral* vs *branco*; iogurte *natural* vs *açucarado*. → canónico **por variante** (chave = família + qualificador).
- **Enriquecimento/processo:** ovos *ómega-3*; *enriquecido*; *light*; *frito/cozido* vs *cru*. → mantém a nutrição própria (não força canónico).
- Detecção por palavras-chave no nome (reusa o vocabulário do `familia.js`/`categoria.js`).

### 3.4 Onde no pipeline
No **fusor** (`fichaEan.js`), a nutrição é escolhida por prioridade de fonte (catálogo>OFF>VLM). Acrescenta-se uma fonte **`canonico`** ACIMA do retail (abaixo de `manual` e da nutrição **oficial do fabricante** confirmada): se o produto é commodity simples (família commodity + sem qualificador), a nutrição canónica entra como a escolhida, com proveniência registada em `fusao` (auditável, reversível). Idempotente.
> Cuidado: a nutrição **oficial confirmada** do fabricante (catálogo 047, `nutricao_confirmada=1`) continua a poder ganhar — é o produto REAL. O canónico vence sobretudo o **OFF/VLM/estimativa** (as fontes ruidosas). Decisão em aberto §6.1.

### 3.5 Combina com o (2)
A TACO **não traz açúcar** → a nutrição canónica do ovo tem açúcar=null. O fix (2) (`acucarAssumivelZero`) faz isso virar 0 → a nota canónica calcula. As duas peças juntas: **todos os ovos de galinha → A (80)**.

## 4. Riscos e mitigação
- **Falso canónico:** um "leite" que é bebida láctea açucarada levaria o perfil de leite simples (errado). → Mitiga: só famílias estritamente commodity + exceção de qualificador rigorosa; em dúvida, NÃO força canónico (mantém retail).
- **Forma errada** (cru vs cozido, pó vs líquido): o descritor canónico tem de bater com a forma vendida. → o qualificador de forma no nome seleciona o descritor; sem certeza, não força.
- **Apagar dados reais:** nunca se ALTERA a nutrição retail guardada; o canónico é uma **fonte na fusão** (a retail fica, só perde a votação). Reversível.
- **Quantidade/locale:** a nota usa por-100g; a TACO já é por-100g. OK.

## 5. Faseamento
- **P0** — `data/nutricao_canonica.json`: mapa família(+qualificador) → descritor TACO/USDA, curado. Tabela de famílias commodity. Revisto pelo dono.
- **P1** — `nutricaoCanonica(familia, nome)` (puro, testável): devolve a nutrição canónica ou null (null quando há qualificador/forma incerta). Golden de casos (ovo, leite meio-gordo vs magro, arroz integral, ómega-3 não força).
- **P2** — ligar como fonte `canonico` no fusor (`fichaEan.js`), abaixo de manual/fabricante-confirmado, acima de OFF/VLM. Re-fundir (`refundir_fichas`) + re-materializar `ns_*`.
- **P3** — **validar**: a auditoria "mesmo nome, notas diferentes" deve **colapsar** para commodities (ovos todos A/B; leite-meio-gordo todos B). Medir a redução dos ~131 grupos.

## 6. Decisões em aberto (dono)
1. **Canónico vs fabricante-confirmado:** quando há nutrição **oficial do fabricante** (catálogo 047) E é commodity simples — quem vence? Proposta: o **fabricante-confirmado** ganha (é o produto real); o canónico só vence OFF/VLM/estimativa/base. *(aberta)*
2. **Âmbito do qualificador:** lista exata de qualificadores que "quebram" o canónico (teor/enriquecimento/forma) — começar restrito e alargar com casos. *(aberta)*
3. **Fonte canónica BR vs PT:** TACO é BR; para PT-PT há o INSA. Por agora TACO/USDA cobrem o genérico; INSA fica para depois. *(proposta: TACO/USDA já chega)*

---
### Referências de código
- `backend/src/normaliza/taco.js` — `nutricaoGenerica` (matcher TACO/FAO/USDA já existente).
- `backend/src/normaliza/familia.js` — `acucarAssumivelZero` (fix 2), famílias.
- `backend/src/normaliza/fichaEan.js` — fusor (onde entra a fonte `canonico`).
- `backend/scripts/calcular_nutriscore_base_local.mjs` — re-materializa `ns_*` após.
- Contexto: [`Nutri_Score_Calculo_e_Personalizacao.md`](Nutri_Score_Calculo_e_Personalizacao.md), [`Normalizacao.md`](Normalizacao.md).

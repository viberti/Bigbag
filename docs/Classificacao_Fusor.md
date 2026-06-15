# Classificação de Produto — o Fusor de Categoria

*Documento de desenho (modelo-alvo), 2026-06-15. Complementa `Taxonomia_Produto.md`
(o modelo facetado) e as aulas `Aula_Classificacao_Produtos.md` / `Aula_Matching_Produtos.md`.
Nasceu de uma análise a fundo do caso "Pérolas" (massa de nome homónimo) + dois casos
de contraste (Nesquik, anchovas). Estatuto: **desenho consolidado, ainda por implementar**
(✅ = peça já existe; ◻ = a construir).*

---

## 0. A moldura — do nome-esquisito à convergência

Começámos a análise a achar que um produto de **nome estranho** ("Pérolas") dava
**pouca informação**. Saímos com o oposto: havia **muitíssima** informação — no EAN,
na foto, na marca — e o **nome era o de menos**. Aliás, o nome foi o único sinal que
**ativou erro** (classificou "Pérolas" como *Roupa*, com 62% de confiança).

> **A lição central:** não se pode **abrir mão** do nome (é a pega humana — o utilizador
> fala e escreve nomes, não EANs), mas também não se pode **depender** dele (às vezes
> faz errar mais do que acertar). O nome é **um voto auto-calibrado**: forte onde é
> especialista (frescos: "Maçã **Gala**"; denominações), ~zero onde é homónimo/abreviado/
> só-marca/estrangeiro. — [dono, 2026-06-15]

Isto generaliza para **todos** os sinais e dá o princípio do documento.

## 1. O princípio: nenhum sinal é o esqueleto

Tentou-se ancorar tudo no OFF (rejeitado: crowdsourced, ruidoso por instância).
Quase se confiou demais no bloco-EAN (corrigido: é específico de cada empresa). O nome
engana nos homónimos. **Conclusão:** a **nossa árvore** é o único ponto fixo; tudo o
resto — loja, OFF, nome, imagem, EAN, marca — é **evidência**, e **cada sinal vota só
tão forte quanto os dados justificam**, com a sua fiabilidade **medida, nunca assumida**.

É o mesmo padrão já provado no `fichaEan.js` (a ficha por EAN é a **fusão campo-a-campo**
de todas as fontes, com prioridade por campo, proveniência registada, manual sagrado,
idempotente). **Este documento é o `fichaEan` da CATEGORIA.**

## 2. A árvore (o ponto fixo)

- **`categoria_no`** — nós **nossos** (slug/label neutros, a UI traduz), com a **nossa**
  granularidade e critério. Single-parent (é uma árvore). Granularidade-alvo = **família**
  (o nó "massa"; o formato penne/pérola é **faceta de dose**, não nó).
- **Lentes como projeções, não sistemas paralelos:** `grupo` (corredor), `seccao_lista`,
  `departamento` (food/non-food), `unidade_base` (€/kg·L·un) são **roll-ups** do nó. Isto
  **subsume** o `grupo`/`tipoConsumidor`/`cat_exib` de hoje.
- **Facetas ortogonais** (dieta/sabor/teor) ficam **ao lado** da árvore: a árvore diz
  **"o que é"**, as facetas dizem **"como é"**. (Reconcilia com o modelo facetado do
  `Taxonomia_Produto`: árvore para a âncora + facetas para os atributos — o que o §9 desse
  doc rejeitou foi uma árvore que **engole** as facetas, não a categoria-âncora.)
- **Duas lentes** (decisão antiga do dono): o mesmo nó projeta para **corredor** (onde se
  compra) e mantém a **natureza** (para nutrição/saúde). Ver o caso das anchovas (§7c).
- **Âncoras ao externo:** cada nó liga-se a uma/várias strings de categoria de OFF/loja —
  para **reusar** sinónimos/crosswalks (GS1/Wikidata), **sem** lhes dar autoridade.

## 3. Os sinais e o peso por-pergunta/por-nível (o coração)

Cada sinal vota num nó com peso = *(o que responde bem)* × *(a sua confiança própria)*.
**Cada sinal é forte numa granularidade diferente** → o fusor usa cada um **ao nível em
que ele é especialista**.

| Sinal | Tier | Responde a… | Peso | Ressalva (medida) |
|---|---|---|---|---|
| **EAN — país** (prefixo GS1) | determinístico | locale | roteia | **só locale para PRIVATE LABELS**; multinacionais = país-sede (ver Nesquik/anchovas) |
| **EAN — empresa** (prefixo de empresa) | determinístico | marca/retalhista | roteia | private label = generalista |
| **EAN — vizinhos item-ref** | auxiliar/condicional | família | **= coerência medida da empresa** | só onde a numeração da empresa é coerente; **0 onde for ruído** |
| **Marca (lida) — perfil IDF por nível** | determinístico | departamento→família | **= concentração medida** | Hacendado: 99% *food*, ~0 família |
| **VLM lê+julga o pacote** | semântico (scan) | família | **alto** | só com foto; saída via ponte, **não escrita direta**; ver §8 |
| **CLIP — vizinhos de imagem** | semântico (scan) | família (cluster) | **alto** | precisa foto; agrupa por **formato de embalagem** (borra massa↔couscous, anchova↔pimento) |
| **OFF — por EAN exato** | determinístico | natureza/denominação | **médio-alto** | fiável (chave); ≠ OFF-por-nome |
| **OFF — por nome (gémeo)** | auxiliar | natureza | médio | FULLTEXT; ruidoso, pode falhar |
| **Catálogo de loja — categoria** | determinístico | corredor/existência | médio | merchandising; compostas ("Arroz e Massa") |
| **Nome** | — | faceta-chave (frescos) | **baixo; homónimo→~0; descritivo→alto** | "Pérolas"→Roupa vs "Filetes de Anchovas"→claro |

**Regra de auto-desconto do nome:** marca-se fraco quando é homónimo conhecido, curto/
genérico, só-marca, ou **quando discorda do EAN/imagem** — o próprio desacordo denuncia-o.

## 4. O fusor (algoritmo barato→caro, com proveniência)

```
0. EAN → país + empresa + vizinhos-item-ref      (determinístico, enquadra tudo)
1. marca-IDF + catálogo + OFF-por-EAN            (votos determinísticos)
2. FUNDE por nível (departamento → família) → vencedor + margem
   margem alta & sem conflito → DECIDE, regista TODOS os votos (incl. perdedores)
3. conflito / homónimo / margem baixa + HÁ FOTO → IMAGEM (CLIP + VLM-julga)
4. ainda ambíguo → LLM-árbitro (offline) ou operador → provisório até resolver
   override do operador = sagrado. idempotente. enriquecer nunca PARTE um nó (só promove).
```

- **A maioria herda o nó deterministicamente** da sua string de categoria (decidida 1×);
  só os ambíguos/conflituosos sobem ao LLM/operador. O LLM **não é o classificador** — é
  o **árbitro dos conflitos** e o **auditor da deriva**, offline e persistido.
- **Proveniência** (como `fichaEan.fusao`): `{ no, via, confianca, margem, votos:[{sinal,
  raw, no, peso}], conflito, resolvido_por }` — *porque é que isto é este nó*, auditável,
  e o "roupa" rejeitado fica registado, não apagado.

## 5. Os artefactos (todos mináveis dos nossos dados, persistidos, auditados)

1. **`categoria_no`** — a árvore + roll-ups (grupo/secção/departamento/unidade) + âncoras.
2. **`categoria_ancora`** — `(fonte, string-de-categoria) → nó`. O conjunto **finito** que
   o LLM classifica **uma vez** (a ponte dos DAGs externos para a nossa árvore).
3. **`marca_perfil`** — `marca → distribuição por nó por nível + concentração`. O IDF-de-
   marcas; de borla melhora o food/não-food (058). *(Medido: 8% das marcas são
   especialistas ≥80%; 52% generalistas. Compal=100% Néctares; Hacendado=99% food mas 467
   categorias.)*
4. **`ean_empresa`** — `prefixo → {país, empresa}` (determinístico) **+** score de
   **coerência da numeração** (auxiliar). Roteamento fiável + voto condicional.
5. **Por produto** — `categoria_no_id` + `categoria_fusao` (proveniência) no
   `sku_normalizado`/`produto_ean`. A `categoria` do Produto Mestre **passa a ser o nó**.

## 6. A jusante (fecha o ciclo)

Nó → **corredor · secção da lista · unidade-base · coorte do Mestre · alternativas** —
tudo **projeção** do nó. As "alternativas similares" passam a ser *"os específicos sob o
mesmo nó (raio: mesmo nó; sobe ao pai se <2), com a mesma faceta de dieta"* — o bug das
Pérolas (mostrar ketchup) desaparece **por construção**.

## 7. Três casos reais (o espetro)

Provam que **o fusor não depende de nenhum subconjunto fixo de sinais** — cada produto
acende os que tem.

### 7a) Pérolas — EAN `8480000062857` (o nome ENGANA; imagem+EAN salvam)
- país 84→ES · empresa 8480000→**Mercadona** · vizinhos item-ref `062xxx`→**massa** (forte)
- marca Hacendado → **food 99%** (corta não-alimentar) · família: nada
- match-por-nome → gémeo `8402001019890`, OFF **"Massas secas"** + nutrição + imagem
- **CLIP: 12/14 massa** + acha **"Pérolas Continente"** (3.º EAN do mesmo produto)
- VLM-pacote ◻ → "Massa Alimentícia · 100% sêmola **trigo duro**" (desfaz couscous/tapioca)
- nome "Pérolas" → **Roupa 0.62** → conflito → **silenciado**
- **⇒ nó = massa**, sobre-determinado (5 votos), +2 EANs descobertos.

### 7b) Nesquik — EAN `7613039766538` (nome AUSENTE; OFF-por-EAN+marca salvam)
- país 76→**Suíça** ⚠️ **armadilha** (Nestlé é multinacional → país-sede, **não** locale)
- empresa 7613039→**Nestlé** · vizinhos item-ref: **ausentes** (auto-silencia)
- **nome: NULL** em todas as fontes
- marca **Nesquik** (especialista cacau) → família ~cacau (médio)
- **off_full por EAN** → "Cacaos y chocolates en polvo · Bebidas instantáneas" (forte)
- imagem: **ausente** (sem scan) → eixo escuro, degrada com elegância
- **⇒ nó = achocolatado/cacau em pó**, via OFF-por-EAN + marca, **sem nome e sem foto**.

### 7c) Anchovas — EAN `4068706499340` (quase tudo escuro; o difícil é a CLASSIFICAÇÃO)
- país 40-44→**Alemanha** ⚠️ armadilha máxima (produto ibérico "Tesoros **del Sur**")
- empresa `4068706`: **desconhecida** · marca "Tesoros Del Sur": **desconhecida** (sem perfil)
- OFF por EAN: **ausente** · OFF por nome: **0** · catálogo: **ausente**
- **nome** (de VLM prévio): **"Filetes de Anchovas em Óleo de Girassol"** — claro, o **herói**
- **CLIP** (3 fotos): topo = outra anchova em óleo (0.616); cluster = **"conserva em óleo"**
  (pimentos, salame, queijo) → confirma o **formato**, o nome dá o **específico** (anchova)
- **A dificuldade não é identificar (todos concordam: anchovas em óleo) — é o NÓ:**
  `grupoDeNome → mercearia` (corredor: conservas) vs `natureza → peixe`. O `grupo` plano
  **colapsa para mercearia e perde a natureza-peixe** → perde o **alergénio peixe** e some
  de uma busca "peixe". **Nenhum sinal extra resolve isto — só a árvore** (um nó "conserva
  de peixe/anchova" que projeta corredor=conservas **mas** mantém natureza=peixe+alergénio).
  É o caso que mais justifica a **árvore-com-duas-lentes**.

### O espetro do nome (a prova viva do §0)
| | sinal-rei | o nome foi… |
|---|---|---|
| Pérolas | imagem + EAN-vizinhos | **vilão** (→Roupa) |
| Nesquik | OFF-por-EAN + marca | **ausente** |
| Anchovas | **nome** + imagem | **herói** (único identificador) |

## 8. O prompt do VLM — a melhorar (item de trabalho) ◻

Hoje o `extrairProdutoFotos` só **lê** (nome/marca/peso/ingredientes/nutrição/validade).
**O VLM já corre no scan** — pedir-lhe que **além de ler, julgue** custa uns tokens e dá um
sinal de categoria **ancorado no pacote inteiro** (o mais valioso para homónimos). Campos
**novos**, mantidos **separados** dos raw (para **não contaminar a identidade**):

- **`tipo_no_pacote`** — o texto de **tipo autodeclarado pelo fabricante**, citado
  ("Massa Alimentícia", "100% sêmola trigo duro", "Bebida de Aveia", "Detergente para
  Loiça", "Azeite Virgem Extra"). *É provavelmente o sinal de categoria mais fiável que
  existe — as palavras do próprio fabricante — e hoje deitamo-lo fora.*
- **`tipo_inferido`** — o **juízo** do VLM sobre que tipo de produto é, **com a evidência**
  (texto + forma visível + instruções de uso/cozedura: "12-14 min" → massa/arroz).
- **(opcional) `pistas_categoria`** — forma do produto visível, ícones, uso.

**Disciplina (a lição do `canonQueijo`):** o VLM **propõe** evidência + palpite; **não
escreve** na nossa árvore — a saída é um **voto** que passa pela ponte `categoria_ancora`.
**Ler primeiro, julgar depois**, campos distintos, e **nunca** deixar o palpite "melhorar"
o nome (renomear "Pérolas"→"Massa Pérolas" contamina a identidade).

## 9. Governança (o custo real, não a construção)

Golden de classificação (como `golden_grupos`) = **gate** do deploy; **juiz-com-canários**
audita a deriva 1×/mês; árvore **versionada**; o LLM **propõe** nós/âncoras novos mas a
adoção é **curada** ("a folha minerada propõe, o vocabulário fechado dispõe"); **override
do operador vence sempre** (entidade materializada, não view).

## 10. Decisões + ramo-piloto + estado

**Decisões (resolvidas nesta análise):**
- Granularidade = **família** (formato = faceta de dose). [dono]
- Single-parent + **nó-irmão** para vegetal (não multi-pai).
- Raio das alternativas = **mesmo nó**, sobe ao pai se <2.
- país-prefixo é locale **só para private labels**; multinacionais = país-sede.
- O nome é **voto auto-calibrado**, nunca esqueleto. [dono]

**Ramo-piloto:** **mercearia alimentar** (massa · arroz · cereais · conservas · molhos ·
leguminosas · farinhas/açúcar) — onde nutrição e alternativas mais pesam. Provar
árvore→ponte(LLM)→herança determinística→fusão→alternativas→golden; só depois expandir.

**Estado das peças:**
- ✅ existe: `fichaEan` (o molde), `classificarPorCatalogo` (voto de família, loja),
  match-por-nome (`acharPorNomeMarca`), match-por-imagem (CLIP/Qdrant, ~57k vetores),
  off_full (OFF por EAN), `marca`/`tipoProduto`, facetas como colunas, IDF de tokens.
- ◻ a construir: a árvore `categoria_no`, a ponte `categoria_ancora` (LLM offline), o
  `marca_perfil`, o `ean_empresa` + coerência, o **fusor** que orquestra tudo com
  proveniência, os **campos novos do VLM** (§8), o golden de classificação.

---

> **Resumo:** a nossa árvore é o ponto fixo; o fusor funde EAN(país/empresa/vizinhos) +
> marca-por-nível + VLM-pacote + CLIP + OFF-por-EAN + nome, **cada um pesado pela sua
> fiabilidade medida**, regista porquê, e o operador corrige. O LLM classifica o conjunto
> **finito** de strings de categoria (offline) e arbitra conflitos. Tudo o resto (corredor,
> secção, coorte, alternativas) é projeção do nó. Três produtos reais provaram que o método
> resolve por **convergência de sinais diferentes** — e que o difícil às vezes não é
> reconhecer, mas **decidir onde pertence**, o que só a árvore-com-duas-lentes resolve.

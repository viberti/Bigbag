# Exploração — Match de produtos entre lojas pela IMAGEM (2026-06-13)

*Hipótese do dono: "é possível fazer match entre produtos vendidos em supermercados diferentes usando apenas a sua imagem".* Snapshot de exploração — não é fonte de verdade; é o registo de um teste e dos seus números.

## Desenho experimental

- **Gabarito = EAN.** Duas imagens com o mesmo EAN em lojas diferentes são o mesmo produto (positivo); EANs diferentes não são (negativo). Sem isto, "match" seria opinião.
- **Dataset:** 200 produtos com imagem **em Auchan E Continente** (de 3.499 EANs partilhados com imagem em ≥2 lojas). CDNs próprios de cada loja → **0% de URLs idênticos** (não é deteção de ficheiro).
- **Os pares são fotos GENUINAMENTE diferentes:** só 1/200 tem pHash trivial (≤16); **96% diferem muito** (ângulo/composição — ex.: Leite Agros frontal no Auchan vs perspetiva 3D no Continente). O teste mede aparência, não re-hospedagem.
- **Negativos:** *aleatório* (produto qualquer) e *difícil* (outro produto da MESMA família de loja — parecido).
- **Métodos:** pHash (DCT, baseline de baixo nível) · **CLIP ViT-B-32** (embedding visual, treinado com pares imagem-texto) · **DINOv2 ViT-B/14** (Meta, self-supervised, **nunca viu texto**). Similaridade = Hamming (pHash) / cosseno (CLIP, DINOv2). Scripts: `backend/scripts/exp_img_{manifesto.mjs,phash.py,clip.py,dinov2.py}` + `inventario_imagens.mjs`.

## Resultado

| AUC (1.0 = separação perfeita) | pHash | CLIP | **DINOv2** |
|---|---|---|---|
| positivo vs aleatório | 0,803 | 0,998 | **0,997** |
| positivo vs **família** (o que importa) | 0,781 | 0,984 | **0,986** |
| F1 (melhor limiar, vs família) | — | 0,945 | **0,942** |

- **DINOv2:** positivos cosseno mediana **0,896** (p10 0,66); negativos-família mediana **0,335** (p90 0,57) → **gap 0,56**, separação mais limpa que o CLIP (gap 0,43). Limiar cos≥0,579 → F1 0,942.
- **CLIP:** positivos mediana 0,835; negativos-família 0,40. Limiar cos≥0,584 → F1 0,945. Nenhum negativo-família > 0,90.
- **pHash:** positivos mediana 108 vs negativos 126 (escala 0..256, 128≈aleatório) — sinal fraco, sobreposição total. **Inútil sozinho**, mas confirma que o match não é trivial.
- **Teto dado pelos DADOS, não pelo modelo:** CLIP e DINOv2 falham nos **mesmos ~8 positivos** (Torta de Laranja, Cápsulas Delta Q, Farinha Branca de Neve…) — produtos cujas fotos divergem radicalmente entre lojas. Onde há aparência partilhada, ambos acertam.

**Conclusão:** a hipótese confirma-se **no regime catálogo×catálogo** — a aparência visual sozinha basta para casar o mesmo produto entre lojas e separá-lo de parecidos (AUC ~0,985, F1 ~0,94). E é **aparência PURA**: o DINOv2, que nunca viu texto, iguala/supera o CLIP → o sinal é forma/cor/estrutura, não a marca escrita lida pelo encoder. **DINOv2 é o candidato preferível** para produção (separação mais limpa, desenhado para retrieval).

## Recuperação 1-para-muitos (o protocolo REAL, não só par-a-par)

O AUC acima é par-a-par (1:1): dado UM par, são o mesmo? O uso real é **recuperação** (1:N): uma foto do Continente procura a sua entre as **200 do Auchan** (galeria) — 199 distratores por consulta. Script: `exp_img_retrieval.py`.

| N=200 queries vs 200 galeria | precisão@1 | @5 | @10 | MRR | rank mediano |
|---|---|---|---|---|---|
| **DINOv2** | 0,955 (191/200) | 0,990 | 0,990 | 0,969 | 1 |
| **CLIP** | **0,965** (193/200) | 0,995 | **1,000** | 0,981 | 1 |

- **A hipótese aguenta o protocolo realista:** ~96% encontram o produto certo à 1.ª, ~99% no top-5. Concorda com o par-a-par (não era otimismo do modo fácil).
- **Reviravolta CLIP↔DINOv2:** o DINOv2 separa melhor pares isolados (AUC), mas o **CLIP recupera melhor numa multidão** — desambiguar entre parecidos beneficia de "ler" a marca, que o DINOv2 não faz. Cada um brilha num protocolo.
- **Os erros SÃO a cautela das variantes (2), medida:** quando o CLIP falha o top-1, é quase sempre para um **irmão da mesma marca/linha** — "Queijo Limiano Meio Gordo"→"Limiano Fatias", "L'Or Ristretto"→"L'Or Espresso", "Estrelitas 270g"→"Estrelitas Mel 550g" (cosseno 0,81 vs 0,81, empate). Erra para o primo, nunca para um produto qualquer.
- **Os dois modelos são COMPLEMENTARES, não redundantes** (`exp_img_overlap.py`): das falhas top-1, só **3/200 falham em AMBOS**; 6 só o DINOv2 erra (CLIP acerta #1), 4 só o CLIP erra (DINOv2 acerta #1). **Ensemble** (aceitar se qualquer um põe em #1) → **197/200 = 98,5%** top-1. Justifica usar os dois juntos.
- **Os 3 casos que ambos falham = o teto dos DADOS, não dos modelos:** (a) *Estrelitas 270g↔550g* (variante de tamanho, imagem idêntica de propósito); (b) *Pão Schar sem glúten* (fotos muito diferentes); (c) *Torta de Laranja* — o Auchan fotografa **o bolo servido num prato**, o Continente **a caixa de plástico embalada**: imagens de coisas visualmente diferentes (produto preparado vs embalagem). Nenhum encoder de aparência casa isto — e prenuncia a cautela #1: a foto-real do utilizador (embalagem na mão) pareceria a versão "embalada", não a "servida".

## Cautelas (o que isto NÃO prova ainda)

1. **Domain gap da foto-real.** Testámos catálogo×catálogo (foto de estúdio, fundo branco). O uso real — **foto do utilizador no supermercado** (fundo, luz, ângulo, dedos) vs catálogo — é muito mais difícil. p@1 0,96 aqui não se transfere automaticamente.
2. **Variantes de tamanho/linha — CONFIRMADA empiricamente** (ver recuperação acima): os erros do top-1 são irmãos da mesma marca (tamanho/sabor). Para o **Produto Mestre** fundir a entidade é desejável; para preço-por-tamanho é um problema — a imagem sozinha não separa "Estrelitas 270g" de "550g". Precisaria do peso/formato (que já temos por outras vias) como desempate.
3. ~~**CLIP "lê" texto grande.**~~ **RESOLVIDA (DINOv2):** corria-se o risco de o sinal vir da marca escrita que o CLIP decodifica. Mas o DINOv2 — self-supervised, **sem texto no treino** — iguala/supera o CLIP (AUC 0,986 vs 0,984). Logo o match é **aparência cega** (forma/cor/estrutura), não tipografia. Cautela eliminada.

## Onde isto encaixa / próximos passos

Liga diretamente ao **gap da Fase 3 / Produto Mestre** (mesmo produto, EANs diferentes): a imagem é um sinal de resolução de entidades que ainda não usamos.
- **Aplicação imediata candidata:** ligar fontes SEM EAN (Pingo Doce, Lidl) ao catálogo com EAN por similaridade de imagem — hoje só ligam por nome.
- **Scan do utilizador → ficha** mesmo quando o EAN não resolve, por vizinhança visual à base de catálogo.
- **Validar antes de construir:** (a) teste foto-real×catálogo; (b) teste variantes-de-tamanho; (c) escalar a similaridade (índice de embeddings) e medir precisão@k num match 1-para-muitos (não só par-a-par).
- **Operacional:** sem GPU; ViT-B-32 em CPU faz ~poucas img/s. Para produção, embeddings pré-computados por foto + busca brute-force. O servidor não tem pip/torch (Python mínimo) — exploração correu no PC; produção exige decidir o runtime.

## Plano de produção v1 (decisões fechadas, 2026-06-13)

Visão do dono: vetorizar TODAS as fotos de catálogo com EAN, guardar os vetores, e casar produtos novos por similaridade. Dimensão medida (`contar_fotos_catalogo.mjs`): **51.777 fotos** com imagem · **36.190 com EAN** → **32.631 EANs distintos** (a galeria-referência) · **15.587 sem EAN** (PD/Lidl = casos-query, o que mais beneficia) · 11% dos EANs já têm ≥2 fotos (multi-foto natural).

| Decisão | Escolha | Porquê |
|---|---|---|
| **1 vetor por** | FOTO (não por EAN) | preserva as vistas; multi-foto do mesmo EAN vota naturalmente; EAN é o label |
| **Modelo v1** | **CLIP ViT-B/32** | ganha em recuperação 1:N (p@1 0,965), mais leve (patch 32 vs 14 do DINOv2 ≈ 5× menos compute), ONNX maduro. DINOv2/ensemble guardados p/ v2 ou se o teste foto-real inverter |
| **Busca** | brute-force numpy/torch | ~36k vetores = <10ms; FAISS/hnsw só a partir de ~1M |
| **Guardar fotos** | SIM, em disco `/var/lib/bigbag/imagens/` (~10 GB de 729 livres) | seguro contra anti-bot do Continente — re-vetorizar (trocar modelo) sem re-baixar |
| **Vetores** | ficheiro em disco regenerável + RAM; **NÃO na BD** | o backup R2 tem teto 5 GB / retém 90d — vetores no mysqldump estourariam-no; BD guarda só tracking leve (qual foto já vetorizada) |
| **Runtime de inferência** | **`@huggingface/transformers` (ONNX) em Node** — a validar por spike | evita meter Python no servidor; mesmo runtime p/ bulk e incremental. Fallback: microserviço Python |
| **Bulk inicial** | ~3-5h CPU, uma vez (PC ou servidor c/ ONNX) | depois incremental <1s/produto |
| **Gate de match** | cosseno ≥ ~0,58 (do F1 medido) + voto multi-foto | abaixo do limiar = "não reconhecido" (honesto) |

**Gate de confiança ANTES de produção:** o teste **foto-real×catálogo** (cautela #1) decide se o match aguenta o scan do utilizador. Construir o pipeline e esse teste em paralelo.

### Construção da v1 — em curso (2026-06-13)

**Ambiente do servidor:** 8 cores, 31 GB RAM, **sem GPU**, MySQL 8 (sem tipo VECTOR), **Docker disponível** (729 GB livres). → self-host em containers, vetores fora da BD, busca brute-force/Qdrant.

**Bake-off de modelos** (`exp_img_bakeoff.py`, recuperação 1:N nos 200):

| modelo | p@1 | p@5 | dim | nota |
|---|---|---|---|---|
| CLIP ViT-L/14 laion2b | **0,995** | 1,000 | 768 | melhor, mas **0,2/s CPU = ~50h** (impraticável sem GPU) |
| **Marqo-Ecommerce-B** ✅ | 0,985 | 1,000 | 768 | **ESCOLHIDO** — e-commerce-specific, 1,2/s (~8h), serving 0,8s/scan |
| Marqo-Ecommerce-L | 0,985 | 1,000 | 1024 | mesmo p@1, vetor maior → descartado |
| CLIP ViT-B/32 laion2b | 0,965 | 0,995 | 512 | baseline |
| DINOv2 large / base | 0,965 / 0,955 | — | 1024/768 | |

**Decisão de modelo:** **Marqo-Ecommerce-B**. O ViT-L é +1 ponto mas 50h CPU e 5s/scan; o Marqo é treinado para produtos (pode generalizar melhor à foto-real), serve a 0,8s e o bulk cabe numa noite. *(Se o teste foto-real favorecer o ViT-L claramente, reconsiderar com GPU cloud para o bulk.)*

**Infra montada (Docker no servidor, todos a 127.0.0.1):**
- `bigbag-infer` — serviço de inferência (`backend/infer/`, FastAPI+torch, modelo plugável por env, batching). `/embed` por ids (lê `/imagens/{id}.jpg`) ou base64 (scan).
- `bigbag-qdrant` — vector DB (coleção `produtos_img`, Cosine, dim 768). Persistência em `/var/lib/bigbag/qdrant`.
- Fotos em `/var/lib/bigbag/imagens/{id}.jpg`; tracking `catalogo_produto.foto_em/vetor_em` (migração 053).
- `scripts/bulk_vetorizar.mjs` — baixa→/embed→Qdrant→marca. Reentrante. **Bulk em curso** (Marqo-B, ~8h, ~36k).

**Pipeline end-to-end VALIDADO** (`matchImagem.js` + `match_imagem_teste.mjs`): vetorizar→Qdrant→top-k funciona. Self-match = **1,000**; vizinhos seguintes são da mesma classe (Ovomaltine → Cola Cao, Tofina, Mokambo… ~0,5). Separação larga "mesmo produto" (~1,0/alto) vs "parecido" (~0,5) → limiar fácil de calibrar (provável ~0,75-0,85, a fixar com positivos reais mesmo-EAN/fontes-diferentes).

**Falta:** bulk terminar (~8h, em curso); calibrar o limiar com positivos reais; integração na app (scan→match→candidatos); aplicação à mineração PD/Lidl→catálogo (produtos sem EAN); teste foto-real×catálogo.

**1.º passo (spike) — ✅ VALIDADO (2026-06-13):** `@huggingface/transformers` carrega CLIP-ONNX e vetoriza **em Node puro** (sem Python/torch/GPU). Consistência com o PyTorch openai: cosseno **0,93–0,99**/imagem (a perda vem da quantização int8 por defeito + preprocessing); a separação positivo/negativo mantém-se nos embeddings do Node. **Runtime de produção desbloqueado: inferência no backend Node.** Afinações antes de cravar: (a) `dtype:'fp32'` (não quantizado) p/ subir a fidelidade a ~0,99; (b) o pacote traz `openai` — medir se chega vs o `laion2b` do teste (p@1 0,965); portar laion2b p/ ONNX só se openai ficar aquém.

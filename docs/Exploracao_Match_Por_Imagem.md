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

## Cautelas (o que isto NÃO prova ainda)

1. **Domain gap da foto-real.** Testámos catálogo×catálogo (foto de estúdio, fundo branco). O uso real — **foto do utilizador no supermercado** (fundo, luz, ângulo, dedos) vs catálogo — é muito mais difícil. p@1 0,96 aqui não se transfere automaticamente.
2. **Variantes de tamanho/linha — CONFIRMADA empiricamente** (ver recuperação acima): os erros do top-1 são irmãos da mesma marca (tamanho/sabor). Para o **Produto Mestre** fundir a entidade é desejável; para preço-por-tamanho é um problema — a imagem sozinha não separa "Estrelitas 270g" de "550g". Precisaria do peso/formato (que já temos por outras vias) como desempate.
3. ~~**CLIP "lê" texto grande.**~~ **RESOLVIDA (DINOv2):** corria-se o risco de o sinal vir da marca escrita que o CLIP decodifica. Mas o DINOv2 — self-supervised, **sem texto no treino** — iguala/supera o CLIP (AUC 0,986 vs 0,984). Logo o match é **aparência cega** (forma/cor/estrutura), não tipografia. Cautela eliminada.

## Onde isto encaixa / próximos passos

Liga diretamente ao **gap da Fase 3 / Produto Mestre** (mesmo produto, EANs diferentes): a imagem é um sinal de resolução de entidades que ainda não usamos.
- **Aplicação imediata candidata:** ligar fontes SEM EAN (Pingo Doce, Lidl) ao catálogo com EAN por similaridade de imagem — hoje só ligam por nome.
- **Scan do utilizador → ficha** mesmo quando o EAN não resolve, por vizinhança visual à base de catálogo.
- **Validar antes de construir:** (a) teste foto-real×catálogo; (b) teste variantes-de-tamanho; (c) escalar a similaridade (índice de embeddings) e medir precisão@k num match 1-para-muitos (não só par-a-par).
- **Operacional:** sem GPU; ViT-B-32 em CPU faz ~poucas img/s. Para produção, embeddings pré-computados por EAN de catálogo + ANN (faiss/hnsw). O servidor não tem pip/torch (Python mínimo) — exploração correu no PC; produção exigiria decidir o runtime (ONNX em Node? serviço Python? API hospedada).

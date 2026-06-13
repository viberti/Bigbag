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

## Cautelas (o que isto NÃO prova ainda)

1. **Domain gap da foto-real.** Testámos catálogo×catálogo (foto de estúdio, fundo branco). O uso real — **foto do utilizador no supermercado** (fundo, luz, ângulo, dedos) vs catálogo — é muito mais difícil. AUC 0,98 aqui não se transfere automaticamente.
2. **Variantes de tamanho.** Os negativos-difíceis são da mesma família, mas falta o caso mais adversarial: a **mesma marca, EAN/tamanho diferente** (Nutella 400g vs 750g — caixa quase idêntica). CLIP pode não distinguir tamanhos — o que para o **Produto Mestre** até é desejável (mesma entidade), mas para preço-por-tamanho não.
3. ~~**CLIP "lê" texto grande.**~~ **RESOLVIDA (DINOv2):** corria-se o risco de o sinal vir da marca escrita que o CLIP decodifica. Mas o DINOv2 — self-supervised, **sem texto no treino** — iguala/supera o CLIP (AUC 0,986 vs 0,984). Logo o match é **aparência cega** (forma/cor/estrutura), não tipografia. Cautela eliminada.

## Onde isto encaixa / próximos passos

Liga diretamente ao **gap da Fase 3 / Produto Mestre** (mesmo produto, EANs diferentes): a imagem é um sinal de resolução de entidades que ainda não usamos.
- **Aplicação imediata candidata:** ligar fontes SEM EAN (Pingo Doce, Lidl) ao catálogo com EAN por similaridade de imagem — hoje só ligam por nome.
- **Scan do utilizador → ficha** mesmo quando o EAN não resolve, por vizinhança visual à base de catálogo.
- **Validar antes de construir:** (a) teste foto-real×catálogo; (b) teste variantes-de-tamanho; (c) escalar a similaridade (índice de embeddings) e medir precisão@k num match 1-para-muitos (não só par-a-par).
- **Operacional:** sem GPU; ViT-B-32 em CPU faz ~poucas img/s. Para produção, embeddings pré-computados por EAN de catálogo + ANN (faiss/hnsw). O servidor não tem pip/torch (Python mínimo) — exploração correu no PC; produção exigiria decidir o runtime (ONNX em Node? serviço Python? API hospedada).

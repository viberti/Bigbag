# Exploração — Match de produtos entre lojas pela IMAGEM (2026-06-13)

*Hipótese do dono: "é possível fazer match entre produtos vendidos em supermercados diferentes usando apenas a sua imagem".* Snapshot de exploração — não é fonte de verdade; é o registo de um teste e dos seus números.

## Desenho experimental

- **Gabarito = EAN.** Duas imagens com o mesmo EAN em lojas diferentes são o mesmo produto (positivo); EANs diferentes não são (negativo). Sem isto, "match" seria opinião.
- **Dataset:** 200 produtos com imagem **em Auchan E Continente** (de 3.499 EANs partilhados com imagem em ≥2 lojas). CDNs próprios de cada loja → **0% de URLs idênticos** (não é deteção de ficheiro).
- **Os pares são fotos GENUINAMENTE diferentes:** só 1/200 tem pHash trivial (≤16); **96% diferem muito** (ângulo/composição — ex.: Leite Agros frontal no Auchan vs perspetiva 3D no Continente). O teste mede aparência, não re-hospedagem.
- **Negativos:** *aleatório* (produto qualquer) e *difícil* (outro produto da MESMA família de loja — parecido).
- **Métodos:** pHash (DCT, baseline de baixo nível) vs **CLIP ViT-B-32** (embedding visual; aparência, não OCR). Similaridade = Hamming (pHash) / cosseno (CLIP). Scripts: `backend/scripts/exp_img_{manifesto.mjs,phash.py,clip.py}` + `inventario_imagens.mjs`.

## Resultado

| AUC (1.0 = separação perfeita) | pHash | **CLIP** |
|---|---|---|
| positivo vs aleatório | 0,803 | **0,998** |
| positivo vs **família** (o que importa) | 0,781 | **0,984** |

- CLIP: positivos cosseno mediana **0,835** (p10 0,69); negativos-família mediana **0,40** (p90 0,58). Limiar cos≥0,584 → **F1 0,945 · precisão 0,91 · recall 0,98**. Nenhum negativo-família > 0,90.
- pHash: positivos mediana 108 vs negativos 126 (escala 0..256, 128≈aleatório) — sinal fraco, sobreposição total. **Inútil sozinho**, mas confirma que o match não é trivial.

**Conclusão:** a hipótese confirma-se **no regime catálogo×catálogo** — a aparência visual sozinha basta para casar o mesmo produto entre lojas e separá-lo de parecidos, com margem prática.

## Cautelas (o que isto NÃO prova ainda)

1. **Domain gap da foto-real.** Testámos catálogo×catálogo (foto de estúdio, fundo branco). O uso real — **foto do utilizador no supermercado** (fundo, luz, ângulo, dedos) vs catálogo — é muito mais difícil. AUC 0,98 aqui não se transfere automaticamente.
2. **Variantes de tamanho.** Os negativos-difíceis são da mesma família, mas falta o caso mais adversarial: a **mesma marca, EAN/tamanho diferente** (Nutella 400g vs 750g — caixa quase idêntica). CLIP pode não distinguir tamanhos — o que para o **Produto Mestre** até é desejável (mesma entidade), mas para preço-por-tamanho não.
3. **CLIP "lê" texto grande.** O image encoder é levemente sensível a tipografia (marca na embalagem) → parte do sinal pode ser o nome, não só forma/cor. Não é OCR, mas não é 100% "aparência cega". Testável mascarando o texto (refinamento).

## Onde isto encaixa / próximos passos

Liga diretamente ao **gap da Fase 3 / Produto Mestre** (mesmo produto, EANs diferentes): a imagem é um sinal de resolução de entidades que ainda não usamos.
- **Aplicação imediata candidata:** ligar fontes SEM EAN (Pingo Doce, Lidl) ao catálogo com EAN por similaridade de imagem — hoje só ligam por nome.
- **Scan do utilizador → ficha** mesmo quando o EAN não resolve, por vizinhança visual à base de catálogo.
- **Validar antes de construir:** (a) teste foto-real×catálogo; (b) teste variantes-de-tamanho; (c) escalar a similaridade (índice de embeddings) e medir precisão@k num match 1-para-muitos (não só par-a-par).
- **Operacional:** sem GPU; ViT-B-32 em CPU faz ~poucas img/s. Para produção, embeddings pré-computados por EAN de catálogo + ANN (faiss/hnsw). O servidor não tem pip/torch (Python mínimo) — exploração correu no PC; produção exigiria decidir o runtime (ONNX em Node? serviço Python? API hospedada).

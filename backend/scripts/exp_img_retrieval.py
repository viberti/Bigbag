#!/usr/bin/env python3
# HIPÓTESE "match por imagem" — RECUPERAÇÃO 1-para-muitos (o uso REAL).
# Diferente do par-a-par (1:1): aqui cada foto do Continente (query) é comparada
# com TODAS as 200 do Auchan (galeria) e vemos se o modelo encontra a certa.
#   precisão@k = a correta (mesmo EAN) está no top-k? · MRR = 1/rank médio.
# Reusa a cache das 400 imagens. Corre DINOv2 e CLIP.
import json, os, sys
from PIL import Image
import torch, numpy as np

MANP = os.environ.get('MANIFESTO', '/tmp/exp_img_manifesto.json')
CACHE = os.environ.get('CACHE', '/tmp/exp_img')
MAN = json.load(open(MANP, encoding='utf-8'))
prods = [o for o in MAN if os.path.exists(f"{CACHE}/{o['ean']}_a.jpg") and os.path.exists(f"{CACHE}/{o['ean']}_b.jpg")]
print(f'produtos (galeria Auchan = queries Continente): {len(prods)}', file=sys.stderr)

def encode_dinov2():
    from transformers import AutoImageProcessor, AutoModel
    proc = AutoImageProcessor.from_pretrained('facebook/dinov2-base')
    model = AutoModel.from_pretrained('facebook/dinov2-base').eval()
    @torch.no_grad()
    def e(path):
        x = proc(images=Image.open(path).convert('RGB'), return_tensors='pt')
        v = model(**x).pooler_output[0]
        return (v / v.norm()).numpy()
    return e

def encode_clip():
    import open_clip
    model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
    model.eval()
    @torch.no_grad()
    def e(path):
        x = preprocess(Image.open(path).convert('RGB')).unsqueeze(0)
        v = model.encode_image(x)[0]
        return (v / v.norm()).numpy()
    return e

def avalia(nome, enc):
    A = np.stack([enc(f"{CACHE}/{p['ean']}_a.jpg") for p in prods])   # galeria Auchan
    B = np.stack([enc(f"{CACHE}/{p['ean']}_b.jpg") for p in prods])   # queries Continente
    S = B @ A.T                                                       # [query, galeria] cosseno
    N = len(prods)
    ranks = []
    falhas = []
    for i in range(N):
        ordem = np.argsort(-S[i])           # galeria ordenada por similaridade desc
        rank = int(np.where(ordem == i)[0][0]) + 1   # posição da correta (1 = top-1)
        ranks.append(rank)
        if rank > 1:
            falhas.append((rank, prods[i]['nome'], prods[ordem[0]]['nome'], float(S[i][ordem[0]]), float(S[i][i])))
    ranks = np.array(ranks)
    p_at = lambda k: float((ranks <= k).mean())
    mrr = float((1 / ranks).mean())
    print(f"\n=== {nome}  (N={N} queries contra {N} galeria) ===")
    print(f"  precisão@1 : {p_at(1):.3f}   ({int((ranks<=1).sum())}/{N} acertam à 1.ª)")
    print(f"  precisão@5 : {p_at(5):.3f}")
    print(f"  precisão@10: {p_at(10):.3f}")
    print(f"  MRR        : {mrr:.3f}   · rank mediano da correta: {int(np.median(ranks))}")
    print(f"  queries em que a correta NÃO foi o top-1: {len(falhas)}")
    for rank, q, top1, s1, sc in sorted(falhas, reverse=True)[:6]:
        print(f"    rank {rank:3d} · query «{q[:34]}» → top1 «{top1[:34]}» (cos {s1:.2f} vs correta {sc:.2f})")

avalia('DINOv2 ViT-B/14', encode_dinov2())
avalia('CLIP ViT-B/32', encode_clip())

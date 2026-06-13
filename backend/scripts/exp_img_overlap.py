#!/usr/bin/env python3
# Cruza as FALHAS de recuperação (top-1 errado) entre DINOv2 e CLIP: os mesmos
# produtos falham em ambos (problema dos DADOS — fotos divergentes) ou cada
# modelo tem as suas (fraqueza do modelo)? Reusa a cache das 400 imagens.
import json, os, sys
from PIL import Image
import torch, numpy as np

MANP = os.environ.get('MANIFESTO', '/tmp/exp_img_manifesto.json')
CACHE = os.environ.get('CACHE', '/tmp/exp_img')
MAN = json.load(open(MANP, encoding='utf-8'))
prods = [o for o in MAN if os.path.exists(f"{CACHE}/{o['ean']}_a.jpg") and os.path.exists(f"{CACHE}/{o['ean']}_b.jpg")]

def ranks_de(enc):
    A = np.stack([enc(f"{CACHE}/{p['ean']}_a.jpg") for p in prods])
    B = np.stack([enc(f"{CACHE}/{p['ean']}_b.jpg") for p in prods])
    S = B @ A.T
    return np.array([int(np.where(np.argsort(-S[i]) == i)[0][0]) + 1 for i in range(len(prods))])

def enc_dino():
    from transformers import AutoImageProcessor, AutoModel
    proc = AutoImageProcessor.from_pretrained('facebook/dinov2-base'); m = AutoModel.from_pretrained('facebook/dinov2-base').eval()
    @torch.no_grad()
    def e(p):
        v = m(**proc(images=Image.open(p).convert('RGB'), return_tensors='pt')).pooler_output[0]; return (v/v.norm()).numpy()
    return e
def enc_clip():
    import open_clip
    m, _, pre = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k'); m.eval()
    @torch.no_grad()
    def e(p):
        v = m.encode_image(pre(Image.open(p).convert('RGB')).unsqueeze(0))[0]; return (v/v.norm()).numpy()
    return e

rd = ranks_de(enc_dino()); print('dino ok', file=sys.stderr)
rc = ranks_de(enc_clip()); print('clip ok', file=sys.stderr)

fd = {prods[i]['ean'] for i in range(len(prods)) if rd[i] > 1}   # falha top-1 DINOv2
fc = {prods[i]['ean'] for i in range(len(prods)) if rc[i] > 1}   # falha top-1 CLIP
nome = {p['ean']: p['nome'] for p in prods}
ri = {p['ean']: (rd[i], rc[i]) for i, p in enumerate(prods)}

print(f"\nfalhas top-1 · DINOv2={len(fd)} · CLIP={len(fc)}")
print(f"\n— AMBOS falham ({len(fd & fc)}) — provável problema dos DADOS (fotos divergem):")
for e in sorted(fd & fc, key=lambda e: -max(ri[e])): print(f"  dino#{ri[e][0]:<3} clip#{ri[e][1]:<3}  {nome[e][:55]}")
print(f"\n— Só DINOv2 falha ({len(fd - fc)}):")
for e in sorted(fd - fc, key=lambda e: -ri[e][0]): print(f"  dino#{ri[e][0]:<3} clip#{ri[e][1]:<3}  {nome[e][:55]}")
print(f"\n— Só CLIP falha ({len(fc - fd)}):")
for e in sorted(fc - fd, key=lambda e: -ri[e][1]): print(f"  dino#{ri[e][0]:<3} clip#{ri[e][1]:<3}  {nome[e][:55]}")
# união: quantos produtos NENHUM dos dois acerta à 1.ª
print(f"\n— Pelo menos um acerta top-1: {len(prods) - len(fd & fc)}/{len(prods)} ({100*(len(prods)-len(fd&fc))//len(prods)}%)")
print(f"— Ensemble ideal (max dos dois) acertaria @1 em: {len(prods) - len(fd & fc)}/{len(prods)}")

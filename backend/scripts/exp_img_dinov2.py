#!/usr/bin/env python3
# HIPÓTESE "match por imagem" — DINOv2 (aparência PURA, sem texto no treino).
# Gémeo de exp_img_clip.py: mesmos pares, mesma cache, métricas comparáveis.
# DINOv2 (Meta, self-supervised) nunca viu legendas → testa se o sinal é forma/
# cor (aparência cega) e não o CLIP a "ler" a marca na embalagem (cautela #3).
import json, os, sys, random
from PIL import Image
import torch
from transformers import AutoImageProcessor, AutoModel

random.seed(42)
MANP = os.environ.get('MANIFESTO', '/tmp/exp_img_manifesto.json')
CACHE = os.environ.get('CACHE', '/tmp/exp_img')
MODELO = os.environ.get('DINO_MODEL', 'facebook/dinov2-base')
MAN = json.load(open(MANP, encoding='utf-8'))

proc = AutoImageProcessor.from_pretrained(MODELO)
model = AutoModel.from_pretrained(MODELO).eval()
print(f'{MODELO} carregado · {len(MAN)} produtos no manifesto', file=sys.stderr)

@torch.no_grad()
def emb(path):
    try:
        x = proc(images=Image.open(path).convert('RGB'), return_tensors='pt')
        out = model(**x)
        v = out.pooler_output[0]          # CLS token (padrão p/ retrieval DINOv2)
        return v / v.norm()
    except Exception as e:
        return None

prod = []
for i, o in enumerate(MAN):
    pa, pb = f"{CACHE}/{o['ean']}_a.jpg", f"{CACHE}/{o['ean']}_b.jpg"
    if not (os.path.exists(pa) and os.path.exists(pb)): continue
    ea, eb = emb(pa), emb(pb)
    if ea is None or eb is None: continue
    prod.append({'ean': o['ean'], 'nome': o['nome'], 'fam': o['familia'], 'ea': ea, 'eb': eb})
    if (i + 1) % 40 == 0: print(f'  ...{i+1}/{len(MAN)}', file=sys.stderr)

n = len(prod)
print(f'\nprodutos com embeddings: {n}')
cos = lambda u, v: float((u * v).sum())
by_fam = {}
for p in prod: by_fam.setdefault(p['fam'], []).append(p)

pos, neg_rand, neg_fam = [], [], []
falhas_pos = []
for p in prod:
    pos.append(cos(p['ea'], p['eb']))
    if cos(p['ea'], p['eb']) < 0.70: falhas_pos.append((cos(p['ea'], p['eb']), p['nome']))
    q = random.choice(prod)
    while q['ean'] == p['ean']: q = random.choice(prod)
    neg_rand.append(cos(p['ea'], q['eb']))
    irmaos = [x for x in by_fam.get(p['fam'], []) if x['ean'] != p['ean']]
    if irmaos:
        neg_fam.append(cos(p['ea'], random.choice(irmaos)['eb']))

def pct(v, q): v = sorted(v); return v[min(len(v)-1, int(q*len(v)))]
def auc(pos, neg):
    if not pos or not neg: return float('nan')
    g = sum((1 if pv > nv else 0.5 if pv == nv else 0) for pv in pos for nv in neg)
    return g / (len(pos) * len(neg))
def best_f1(pos, neg):
    best = (0, 0, 0, 0)
    for t in sorted(set(round(x, 3) for x in pos + neg)):
        tp = sum(1 for x in pos if x >= t); fp = sum(1 for x in neg if x >= t)
        fn = len(pos) - tp
        prec = tp / (tp + fp) if tp + fp else 0; rec = tp / (tp + fn) if tp + fn else 0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0
        if f1 > best[0]: best = (f1, t, prec, rec)
    return best

print(f"\n— Cosseno DINOv2 ({MODELO})")
print(f"  POSITIVO   n={len(pos):3d}  mediana={pct(pos,.5):.3f}  p25={pct(pos,.25):.3f}  p10={pct(pos,.10):.3f}")
print(f"  NEG aleat. n={len(neg_rand):3d}  mediana={pct(neg_rand,.5):.3f}  p90={pct(neg_rand,.90):.3f}")
print(f"  NEG fam.   n={len(neg_fam):3d}  mediana={pct(neg_fam,.5):.3f}  p90={pct(neg_fam,.90):.3f}")
print(f"\n— AUC      positivo vs aleatório : {auc(pos, neg_rand):.3f}   (CLIP 0.998 · pHash 0.803)")
print(f"           positivo vs família   : {auc(pos, neg_fam):.3f}   (CLIP 0.984 · pHash 0.781)  ← o teste")
f1, t, prec, rec = best_f1(pos, neg_fam)
print(f"— Melhor threshold (vs família): cos≥{t:.3f}  F1={f1:.3f}  prec={prec:.3f}  rec={rec:.3f}   (CLIP F1 0.945)")
print('\n— POSITIVOS que o DINOv2 ainda falha:')
for s, nome in sorted(falhas_pos)[:8]: print(f"  cos {s:.3f}  {nome[:62]}")

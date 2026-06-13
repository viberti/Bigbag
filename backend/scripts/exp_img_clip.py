#!/usr/bin/env python3
# HIPÓTESE "match por imagem (aparência pura)" — o TESTE: embeddings CLIP.
# Reusa as imagens já em cache (do baseline pHash) e o manifesto. Para cada
# produto computa o embedding VISUAL (image encoder do CLIP, ViT-B-32) de ambas
# as lojas; mede a similaridade de cosseno nos mesmos pares do baseline:
#   POSITIVO = mesmo EAN, lojas diferentes
#   NEG aleatório / NEG mesma família
# Reporta AUC, separação, threshold de melhor F1, e os casos-limite — comparável
# ao pHash (o piso). CLIP capta APARÊNCIA (forma/cor/layout), não decodifica
# texto como um VLM faria (embora seja levemente sensível a texto grande).
import json, os, sys, random
from PIL import Image
import torch, open_clip

random.seed(42)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANP = os.environ.get('MANIFESTO', '/tmp/exp_img_manifesto.json')
CACHE = os.environ.get('CACHE', '/tmp/exp_img')
MAN = json.load(open(MANP, encoding='utf-8'))

model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
model.eval()
print(f'CLIP carregado (ViT-B-32 laion2b) · {len(MAN)} produtos no manifesto', file=sys.stderr)

@torch.no_grad()
def emb(path):
    try:
        x = preprocess(Image.open(path).convert('RGB')).unsqueeze(0)
        v = model.encode_image(x)
        return (v / v.norm(dim=-1, keepdim=True))[0]
    except Exception:
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
falhas_pos, falsos_neg = [], []
for p in prod:
    s = cos(p['ea'], p['eb']); pos.append(s)
    if s < 0.80: falhas_pos.append((s, p['nome']))
    q = random.choice(prod)
    while q['ean'] == p['ean']: q = random.choice(prod)
    neg_rand.append(cos(p['ea'], q['eb']))
    irmaos = [x for x in by_fam.get(p['fam'], []) if x['ean'] != p['ean']]
    if irmaos:
        q2 = random.choice(irmaos); sf = cos(p['ea'], q2['eb']); neg_fam.append(sf)
        if sf > 0.90: falsos_neg.append((sf, p['nome'], q2['nome']))

def pct(v, q): v = sorted(v); return v[min(len(v)-1, int(q*len(v)))]
def auc(pos, neg):  # MAIOR cosseno ⇒ match: P(pos > neg)
    if not pos or not neg: return float('nan')
    g = sum((1 if pv > nv else 0.5 if pv == nv else 0) for pv in pos for nv in neg)
    return g / (len(pos) * len(neg))
def best_f1(pos, neg):
    cand = sorted(set([round(x, 3) for x in pos + neg]))
    best = (0, 0)
    for t in cand:
        tp = sum(1 for x in pos if x >= t); fp = sum(1 for x in neg if x >= t)
        fn = len(pos) - tp
        prec = tp / (tp + fp) if tp + fp else 0; rec = tp / (tp + fn) if tp + fn else 0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0
        if f1 > best[0]: best = (f1, t, prec, rec)
    return best

print(f"\n— Similaridade de cosseno CLIP (1.0 = idêntico)")
print(f"  POSITIVO (mesmo EAN)   n={len(pos):3d}  mediana={pct(pos,.5):.3f}  p25={pct(pos,.25):.3f}  p10={pct(pos,.10):.3f}")
print(f"  NEG aleatório          n={len(neg_rand):3d}  mediana={pct(neg_rand,.5):.3f}  p90={pct(neg_rand,.90):.3f}")
print(f"  NEG mesma família      n={len(neg_fam):3d}  mediana={pct(neg_fam,.5):.3f}  p90={pct(neg_fam,.90):.3f}")
print(f"\n— AUC (1.0 = separação perfeita)")
print(f"  positivo vs aleatório : {auc(pos, neg_rand):.3f}   (pHash deu 0.803)")
print(f"  positivo vs família   : {auc(pos, neg_fam):.3f}   ← o teste real (pHash deu 0.781)")
f1, t, prec, rec = best_f1(pos, neg_fam)
print(f"\n— Melhor threshold (positivo vs família): cos≥{t:.3f}  F1={f1:.3f}  precisão={prec:.3f}  recall={rec:.3f}")
print('\n— POSITIVOS que o CLIP ainda falha (cos baixo — mesmo produto, vê diferente):')
for s, nome in sorted(falhas_pos)[:8]: print(f"  cos {s:.3f}  {nome[:62]}")
print('\n— Falsos matches difíceis (produtos diferentes da família, cos alto):')
for s, a, b in sorted(falsos_neg, reverse=True)[:8]: print(f"  cos {s:.3f}  {a[:32]}  ~  {b[:32]}")

#!/usr/bin/env python3
# HIPÓTESE "várias fotos por EAN na galeria melhoram o reconhecimento de uma
# foto NOVA?" — usa 3 fontes independentes por EAN: Auchan (estúdio, já em cache
# _a), Continente (estúdio, _b) e OFF (crowdsourced/telemóvel, baixado _o).
#   query  = foto Auchan (a "nova", held-out)
#   galeria SINGLE = {Continente}          (1 foto/EAN)
#   galeria MULTI  = {Continente, OFF}     (2 fotos/EAN, score = MAX da sim)
# Mede precisão@1/@5 e MRR sobre os MESMOS EANs (os que têm as 3 fotos).
import json, os, sys, urllib.request
from PIL import Image
import torch, numpy as np

MANP = os.environ.get('MANIFESTO', '/tmp/exp_img_manifesto.json')
CACHE = os.environ.get('CACHE', '/tmp/exp_img')
MAN = json.load(open(MANP, encoding='utf-8'))
UA = {'User-Agent': 'Mozilla/5.0 (BigBag research)'}

def baixar(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return True
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            ct = r.headers.get('Content-Type', ''); data = r.read()
        if not ct.startswith('image/') or len(data) < 500: return False
        open(dest, 'wb').write(data); return True
    except Exception:
        return False

def off_front(ean):
    try:
        u = f"https://world.openfoodfacts.org/api/v2/product/{ean}.json?fields=image_front_url,image_url"
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20) as r:
            d = json.loads(r.read())
        p = d.get('product') or {}
        return p.get('image_front_url') or p.get('image_url')
    except Exception:
        return None

# baixa a 3.ª foto (OFF) para os EANs do dataset
ncov = 0
for i, o in enumerate(MAN):
    po = f"{CACHE}/{o['ean']}_o.jpg"
    if os.path.exists(po): ncov += 1; continue
    url = off_front(o['ean'])
    if url and baixar(url, po): ncov += 1
    if (i + 1) % 40 == 0: print(f'  ...OFF {i+1}/{len(MAN)} (cobertura {ncov})', file=sys.stderr)

# só EANs com as TRÊS fotos
tri = [o for o in MAN if all(os.path.exists(f"{CACHE}/{o['ean']}_{s}.jpg") for s in ('a', 'b', 'o'))]
print(f"\nEANs no OFF c/ foto: {ncov}/{len(MAN)} · com as 3 fotos (A+C+OFF): {len(tri)}")
if len(tri) < 30:
    print('poucos trios; aumentar amostra ou re-amostrar EANs do OFF'); sys.exit(0)

import open_clip
model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k'); model.eval()
@torch.no_grad()
def emb(path):
    v = model.encode_image(preprocess(Image.open(path).convert('RGB')).unsqueeze(0))[0]
    return (v / v.norm()).numpy()

A = np.stack([emb(f"{CACHE}/{o['ean']}_a.jpg") for o in tri])   # queries (Auchan)
C = np.stack([emb(f"{CACHE}/{o['ean']}_b.jpg") for o in tri])   # galeria Continente
O = np.stack([emb(f"{CACHE}/{o['ean']}_o.jpg") for o in tri])   # galeria OFF
N = len(tri)

def metrics(scores):  # scores[i][j] = afinidade query i ↔ EAN j
    ranks = np.array([int(np.where(np.argsort(-scores[i]) == i)[0][0]) + 1 for i in range(N)])
    return (ranks <= 1).mean(), (ranks <= 5).mean(), (1 / ranks).mean()

sc_C = A @ C.T                          # SINGLE: só Continente
sc_O = A @ O.T                          # SINGLE: só OFF
sc_multi = np.maximum(A @ C.T, A @ O.T) # MULTI: max(Continente, OFF)
sc_mean = (A @ C.T + A @ O.T) / 2       # MULTI: média

print(f"\n— Recuperação (query = foto Auchan «nova», N={N} EANs) · CLIP ViT-B/32")
print(f"{'condição':28} {'p@1':>6} {'p@5':>6} {'MRR':>6}")
for nome, s in [('SINGLE só Continente', sc_C), ('SINGLE só OFF', sc_O),
                ('MULTI max(Cont,OFF)', sc_multi), ('MULTI média(Cont,OFF)', sc_mean)]:
    p1, p5, mrr = metrics(s)
    print(f"{nome:28} {p1:6.3f} {p5:6.3f} {mrr:6.3f}")
print("\n(MULTI > melhor SINGLE ⇒ ter várias fotos/EAN na galeria melhora o reconhecimento)")

#!/usr/bin/env python3
# HIPÓTESE "match por imagem" — BASELINE pHash (controle de baixo nível).
# Lê /tmp/exp_img_manifesto.json, baixa as imagens (cache em /tmp/exp_img/),
# computa o perceptual hash (DCT) de cada e mede a distância de Hamming nos pares:
#   POSITIVO       = a[ean] vs b[ean]            (mesmo produto, lojas diferentes)
#   NEG aleatório  = a[ean] vs b[outro]          (produto qualquer)
#   NEG difícil    = a[ean] vs b[mesma família]  (produto parecido)
# Mede AUC (Mann-Whitney) positivo-vs-negativo e mostra os casos-limite.
# pHash é o PISO: pega "mesma foto"; o que ele NÃO separa é o território do CLIP.
import json, os, sys, urllib.request, random
from io import BytesIO
from PIL import Image
import imagehash

random.seed(42)
MAN = json.load(open('/tmp/exp_img_manifesto.json'))
CACHE = '/tmp/exp_img'; os.makedirs(CACHE, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0'}

def baixar(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return True
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        if not data: return False
        open(dest, 'wb').write(data); return True
    except Exception:
        return False

def phash(path):
    try:
        return imagehash.phash(Image.open(path).convert('RGB'), hash_size=16)
    except Exception:
        return None

# baixa + hash de cada produto (lado a = auchan, lado b = continente)
prod = []
for i, o in enumerate(MAN):
    pa, pb = f"{CACHE}/{o['ean']}_a.jpg", f"{CACHE}/{o['ean']}_b.jpg"
    if not baixar(o['url_a'], pa) or not baixar(o['url_b'], pb): continue
    ha, hb = phash(pa), phash(pb)
    if ha is None or hb is None: continue
    prod.append({'ean': o['ean'], 'nome': o['nome'], 'fam': o['familia'], 'ha': ha, 'hb': hb})
    if (i + 1) % 40 == 0: print(f'  ...{i+1}/{len(MAN)} processados', file=sys.stderr)

n = len(prod)
print(f'\nprodutos com par de imagens válido: {n}/{len(MAN)}')
if n < 30:
    print('amostra pequena demais; abortar'); sys.exit(0)

by_fam = {}
for p in prod: by_fam.setdefault(p['fam'], []).append(p)

pos, neg_rand, neg_fam = [], [], []
casos_pos_alto, casos_neg_baixo = [], []
for p in prod:
    d = p['ha'] - p['hb']          # distância de Hamming (0 = idêntico)
    pos.append(d)
    if d >= 60: casos_pos_alto.append((d, p['nome']))   # mesmo produto, fotos MUITO diferentes
    # negativo aleatório
    q = random.choice(prod)
    while q['ean'] == p['ean']: q = random.choice(prod)
    dr = p['ha'] - q['hb']; neg_rand.append(dr)
    # negativo difícil: outro da mesma família
    irmaos = [x for x in by_fam.get(p['fam'], []) if x['ean'] != p['ean']]
    if irmaos:
        q2 = random.choice(irmaos); df = p['ha'] - q2['hb']; neg_fam.append(df)
        if df <= 24: casos_neg_baixo.append((df, p['nome'], q2['nome']))  # parecidos demais

def pct(v, q):
    v = sorted(v); return v[min(len(v)-1, int(q*len(v)))]
def auc(pos, neg):  # P(neg > pos): menor distância ⇒ match
    if not pos or not neg: return float('nan')
    import itertools
    g = sum((1 if nv > pv else 0.5 if nv == pv else 0) for pv in pos for nv in neg)
    return g / (len(pos) * len(neg))

print(f"\n— Distância pHash (Hamming, 0=idêntico · hash 16x16 ⇒ 0..256)")
print(f"  POSITIVO (mesmo EAN)      n={len(pos):3d}  mediana={pct(pos,.5):3d}  p25={pct(pos,.25):3d}  p75={pct(pos,.75):3d}")
print(f"  NEG aleatório             n={len(neg_rand):3d}  mediana={pct(neg_rand,.5):3d}  p25={pct(neg_rand,.25):3d}")
print(f"  NEG mesma família         n={len(neg_fam):3d}  mediana={pct(neg_fam,.5):3d}  p25={pct(neg_fam,.25):3d}")
print(f"\n— AUC (1.0 = separação perfeita; 0.5 = aleatório)")
print(f"  positivo vs aleatório : {auc(pos, neg_rand):.3f}")
print(f"  positivo vs família   : {auc(pos, neg_fam):.3f}   ← o teste que importa")

# fração de positivos 'triviais' (mesma foto, dist baixa) vs 'difíceis' (dist alta)
triviais = sum(1 for d in pos if d <= 16)
dificeis = sum(1 for d in pos if d >= 50)
print(f"\n— Regime dos POSITIVOS: triviais (≤16, ~mesma foto)={triviais}/{n} ({100*triviais//n}%) · difíceis (≥50)={dificeis}/{n} ({100*dificeis//n}%)")
print('\n— POSITIVOS que o pHash FALHA (mesmo produto, fotos diferentes — território do CLIP):')
for d, nome in sorted(casos_pos_alto, reverse=True)[:8]: print(f"  dist {d:3d}  {nome[:60]}")
print('\n— NEGATIVOS que o pHash confunde (produtos diferentes, fotos parecidas):')
for d, a, b in sorted(casos_neg_baixo)[:8]: print(f"  dist {d:3d}  {a[:34]}  ~  {b[:34]}")

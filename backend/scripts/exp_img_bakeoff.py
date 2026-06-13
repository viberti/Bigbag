#!/usr/bin/env python3
# BAKE-OFF de modelos para match-por-imagem (ir a sério): avalia vários encoders
# no MESMO protocolo de recuperação 1:N (query=Continente vs galeria=Auchan, N=200)
# e tabela precisão@1/@5 + MRR. Inclui modelos genéricos (CLIP, DINOv2, SigLIP) e
# e-commerce-specific (Marqo). Reusa a cache das 400 imagens.
import json, os, sys
from PIL import Image
import torch, numpy as np

MANP = os.environ.get('MANIFESTO', '/tmp/exp_img_manifesto.json')
CACHE = os.environ.get('CACHE', '/tmp/exp_img')
MAN = json.load(open(MANP, encoding='utf-8'))
prods = [o for o in MAN if os.path.exists(f"{CACHE}/{o['ean']}_a.jpg") and os.path.exists(f"{CACHE}/{o['ean']}_b.jpg")]
print(f'{len(prods)} produtos (400 imagens) em cache', file=sys.stderr)

def enc_openclip(name, pretrained=None):
    import open_clip
    arg = name if name.startswith('hf-hub:') else name
    model, _, pre = open_clip.create_model_and_transforms(arg, pretrained=pretrained)
    model.eval()
    @torch.no_grad()
    def e(p):
        v = model.encode_image(pre(Image.open(p).convert('RGB')).unsqueeze(0))[0]
        return (v / v.norm()).numpy()
    return e

def enc_hf_image(model_id, kind):
    from transformers import AutoModel, AutoProcessor, AutoImageProcessor
    if kind == 'siglip':
        proc = AutoProcessor.from_pretrained(model_id); model = AutoModel.from_pretrained(model_id).eval()
        @torch.no_grad()
        def e(p):
            x = proc(images=Image.open(p).convert('RGB'), return_tensors='pt')
            v = model.get_image_features(pixel_values=x['pixel_values'])[0]
            return (v / v.norm()).numpy()
        return e
    else:  # dinov2
        proc = AutoImageProcessor.from_pretrained(model_id); model = AutoModel.from_pretrained(model_id).eval()
        @torch.no_grad()
        def e(p):
            x = proc(images=Image.open(p).convert('RGB'), return_tensors='pt')
            v = model(**x).pooler_output[0]
            return (v / v.norm()).numpy()
        return e

# (rótulo, factory) — os já medidos entram p/ a tabela ficar completa
MODELOS = [
    ('CLIP ViT-B/32 laion2b (baseline)', lambda: enc_openclip('ViT-B-32', 'laion2b_s34b_b79k')),
    ('CLIP ViT-L/14 laion2b',            lambda: enc_openclip('ViT-L-14', 'laion2b_s32b_b82k')),
    ('DINOv2 base',                      lambda: enc_hf_image('facebook/dinov2-base', 'dinov2')),
    ('DINOv2 large',                     lambda: enc_hf_image('facebook/dinov2-large', 'dinov2')),
    ('SigLIP2 base',                     lambda: enc_hf_image('google/siglip2-base-patch16-224', 'siglip')),
    ('Marqo-Ecommerce B (e-commerce)',   lambda: enc_openclip('hf-hub:Marqo/marqo-ecommerce-embeddings-B')),
]

def avalia(enc):
    A = np.stack([enc(f"{CACHE}/{o['ean']}_a.jpg") for o in prods])
    B = np.stack([enc(f"{CACHE}/{o['ean']}_b.jpg") for o in prods])
    S = B @ A.T; N = len(prods)
    ranks = np.array([int(np.where(np.argsort(-S[i]) == i)[0][0]) + 1 for i in range(N)])
    return (ranks <= 1).mean(), (ranks <= 5).mean(), (1 / ranks).mean(), A.shape[1]

resultados = []
for nome, fac in MODELOS:
    try:
        print(f'\n>>> {nome}', file=sys.stderr)
        p1, p5, mrr, dim = avalia(fac())
        resultados.append((nome, p1, p5, mrr, dim))
        print(f'   p@1={p1:.3f} p@5={p5:.3f} MRR={mrr:.3f} dim={dim}', file=sys.stderr)
    except Exception as ex:
        print(f'   FALHOU: {ex}', file=sys.stderr)
        resultados.append((nome, None, None, None, None))

print(f"\n{'modelo':36} {'p@1':>6} {'p@5':>6} {'MRR':>6} {'dim':>5}")
print('-' * 62)
for nome, p1, p5, mrr, dim in sorted(resultados, key=lambda r: -(r[1] or 0)):
    if p1 is None: print(f"{nome:36} {'(falhou)':>6}")
    else: print(f"{nome:36} {p1:6.3f} {p5:6.3f} {mrr:6.3f} {dim:5d}")

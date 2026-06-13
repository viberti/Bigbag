#!/usr/bin/env python3
# Serviço de INFERÊNCIA de embeddings de imagem (match-por-imagem, 2026-06-13).
# Container Docker isolado (Python+torch) — resolve o "servidor sem Python".
# Carrega UM modelo (plugável por env) e expõe HTTP para o backend Node:
#   GET  /health           → {ok, modelo, dim}
#   POST /embed {ids:[…]}   → vetores das fotos /imagens/{id}.jpg (bulk)
#   POST /embed {b64:[…]}   → vetores de imagens enviadas em base64 (serving/scan)
# Modelo via env: MODELO_TIPO=openclip|siglip|dinov2 · MODELO_ID · MODELO_PRE.
import os, io, base64, sys
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from PIL import Image
import torch

TIPO = os.environ.get('MODELO_TIPO', 'openclip')
MID = os.environ.get('MODELO_ID', 'ViT-B-32')
MPRE = os.environ.get('MODELO_PRE', 'laion2b_s34b_b79k')
IMG_DIR = os.environ.get('IMG_DIR', '/imagens')
torch.set_num_threads(int(os.environ.get('THREADS', '8')))

def carregar():
    if TIPO == 'openclip':
        import open_clip
        arg = MID if MID.startswith('hf-hub:') else MID
        model, _, pre = open_clip.create_model_and_transforms(arg, pretrained=(MPRE or None))
        model.eval()
        @torch.no_grad()
        def enc(img):
            v = model.encode_image(pre(img).unsqueeze(0))[0]
            return (v / v.norm()).cpu().numpy().astype('float32')
        return enc
    if TIPO == 'siglip':
        from transformers import AutoModel, AutoProcessor
        proc = AutoProcessor.from_pretrained(MID); model = AutoModel.from_pretrained(MID).eval()
        @torch.no_grad()
        def enc(img):
            x = proc(images=img, return_tensors='pt')
            v = model.get_image_features(pixel_values=x['pixel_values'])[0]
            return (v / v.norm()).cpu().numpy().astype('float32')
        return enc
    if TIPO == 'dinov2':
        from transformers import AutoModel, AutoImageProcessor
        proc = AutoImageProcessor.from_pretrained(MID); model = AutoModel.from_pretrained(MID).eval()
        @torch.no_grad()
        def enc(img):
            x = proc(images=img, return_tensors='pt')
            v = model(**x).pooler_output[0]
            return (v / v.norm()).cpu().numpy().astype('float32')
        return enc
    raise SystemExit(f'MODELO_TIPO desconhecido: {TIPO}')

print(f'a carregar {TIPO}:{MID}:{MPRE} …', file=sys.stderr)
ENC = carregar()
DIM = int(ENC(Image.new('RGB', (64, 64))).shape[0])
print(f'pronto · dim={DIM}', file=sys.stderr)

app = FastAPI()

class Req(BaseModel):
    ids: list[int] = []
    b64: list[str] = []

@app.get('/health')
def health():
    return {'ok': True, 'modelo': f'{TIPO}:{MID}:{MPRE}', 'dim': DIM}

@app.post('/embed')
def embed(req: Req):
    out = []
    for i in req.ids:
        p = f'{IMG_DIR}/{i}.jpg'
        try:
            out.append({'id': i, 'vec': ENC(Image.open(p).convert('RGB')).tolist()})
        except Exception as e:
            out.append({'id': i, 'erro': str(e)})
    for b in req.b64:
        try:
            img = Image.open(io.BytesIO(base64.b64decode(b))).convert('RGB')
            out.append({'vec': ENC(img).tolist()})
        except Exception as e:
            out.append({'erro': str(e)})
    return {'dim': DIM, 'itens': out}

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
    # devolve enc_batch(list[PIL.Image]) → np.ndarray [N, DIM] L2-normalizado.
    # Batching faz UMA forward pass por lote (muito mais rápido em CPU que 1 a 1).
    if TIPO == 'openclip':
        import open_clip
        model, _, pre = open_clip.create_model_and_transforms(MID, pretrained=(MPRE or None))
        model.eval()
        @torch.no_grad()
        def enc_batch(imgs):
            batch = torch.stack([pre(im) for im in imgs])
            v = model.encode_image(batch)
            v = v / v.norm(dim=-1, keepdim=True)
            return v.cpu().numpy().astype('float32')
        return enc_batch
    if TIPO == 'siglip':
        from transformers import AutoModel, AutoProcessor
        proc = AutoProcessor.from_pretrained(MID); model = AutoModel.from_pretrained(MID).eval()
        @torch.no_grad()
        def enc_batch(imgs):
            x = proc(images=list(imgs), return_tensors='pt')
            v = model.get_image_features(pixel_values=x['pixel_values'])
            v = v / v.norm(dim=-1, keepdim=True)
            return v.cpu().numpy().astype('float32')
        return enc_batch
    if TIPO == 'dinov2':
        from transformers import AutoModel, AutoImageProcessor
        proc = AutoImageProcessor.from_pretrained(MID); model = AutoModel.from_pretrained(MID).eval()
        @torch.no_grad()
        def enc_batch(imgs):
            x = proc(images=list(imgs), return_tensors='pt')
            v = model(**x).pooler_output
            v = v / v.norm(dim=-1, keepdim=True)
            return v.cpu().numpy().astype('float32')
        return enc_batch
    raise SystemExit(f'MODELO_TIPO desconhecido: {TIPO}')

print(f'a carregar {TIPO}:{MID}:{MPRE} …', file=sys.stderr)
ENC = carregar()
DIM = int(ENC([Image.new('RGB', (64, 64))]).shape[1])
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
    # abre todas as imagens (válidas vão a um batch; inválidas viram erro na ordem)
    out, imgs, slots = [], [], []
    for i in req.ids:
        try:
            imgs.append(Image.open(f'{IMG_DIR}/{i}.jpg').convert('RGB')); slots.append(len(out)); out.append({'id': i})
        except Exception as e:
            out.append({'id': i, 'erro': str(e)})
    for b in req.b64:
        try:
            imgs.append(Image.open(io.BytesIO(base64.b64decode(b))).convert('RGB')); slots.append(len(out)); out.append({})
        except Exception as e:
            out.append({'erro': str(e)})
    if imgs:
        vecs = ENC(imgs)
        for k, s in enumerate(slots):
            out[s]['vec'] = vecs[k].tolist()
    return {'dim': DIM, 'itens': out}

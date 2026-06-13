// MINIATURA NORMALIZADA de uma imagem de catálogo (match-por-imagem / carrossel):
// recorta a moldura de fundo uniforme (sharp.trim) e enquadra num QUADRADO fixo,
// para os produtos ficarem grandes e de tamanho parecido entre cartões. Partilhada
// pelo lote (scripts/gerar_thumbs.mjs) e pelo endpoint (gera on-the-fly se faltar).
//   /var/lib/bigbag/imagens/{id}.jpg  →  /var/lib/bigbag/thumbs/{id}.webp
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

export const IMG_DIR = process.env.IMG_DIR || '/var/lib/bigbag/imagens';
export const THUMBS_DIR = process.env.THUMBS_DIR || '/var/lib/bigbag/thumbs';
const LADO = Number(process.env.THUMB_LADO) || 500; // px do quadrado (nítido em retina, webp leve)
const FUNDO = '#ffffff';
let _dirOk = false;

// Devolve o caminho da miniatura (gerando-a se faltar) ou null se não houver
// imagem-fonte. `forcar` regenera mesmo que exista (p/ mudar parâmetros).
export async function gerarThumbCatalogo(id, { forcar = false } = {}) {
  const src = `${IMG_DIR}/${id}.jpg`;
  const dest = `${THUMBS_DIR}/${id}.webp`;
  if (!forcar && existsSync(dest)) return dest;
  if (!existsSync(src)) return null;
  if (!_dirOk) { await mkdir(THUMBS_DIR, { recursive: true }).catch(() => {}); _dirOk = true; }
  const resize = { fit: 'contain', background: FUNDO };
  try {
    // flatten ANTES do trim (alfa→branco p/ o trim ver fundo uniforme); trim corta
    // a moldura; resize enquadra no quadrado. threshold tolera ruído de JPEG no branco.
    await sharp(src).flatten({ background: FUNDO }).trim({ threshold: 20 })
      .resize(LADO, LADO, resize).webp({ quality: 80 }).toFile(dest);
  } catch {
    // trim falha em imagem toda uniforme / formato estranho → sem trim, só enquadra
    try {
      await sharp(src).flatten({ background: FUNDO })
        .resize(LADO, LADO, resize).webp({ quality: 80 }).toFile(dest);
    } catch { return null; }
  }
  return existsSync(dest) ? dest : null;
}

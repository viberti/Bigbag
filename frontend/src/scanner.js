// Digitalização de documento no browser (jscanify + OpenCV.js): detecta as
// bordas do talão e corrige a perspectiva (achata) antes do upload.
// OpenCV.js (~8MB) é carregado sob demanda, só no 1º uso. Qualquer falha →
// devolve o ficheiro original (nunca quebra o upload).
//
// Estratégia (do melhor para o pior, sempre que houver contorno):
//   1) 4 cantos plausíveis → correção de perspetiva (warp) — o ideal.
//   2) sem cantos para o warp → RECORTE pela bounding box do contorno.
//   3) sem contorno de todo → foto original.

let cvPronto = null;
function carregarOpenCV() {
  if (cvPronto) return cvPronto;
  cvPronto = new Promise((resolve, reject) => {
    if (window.cv && window.cv.Mat) return resolve();
    const s = document.createElement('script');
    s.src = 'https://docs.opencv.org/4.10.0/opencv.js';
    s.async = true;
    s.onload = () => {
      const cv = window.cv;
      if (cv && cv.Mat) return resolve();
      if (cv && typeof cv.then === 'function') return cv.then(() => resolve()).catch(reject);
      if (cv) cv.onRuntimeInitialized = () => resolve();
      else reject(new Error('OpenCV ausente'));
    };
    s.onerror = () => reject(new Error('falha a carregar OpenCV'));
    document.head.appendChild(s);
  });
  return cvPronto;
}

function ficheiroParaImagem(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const desde = (t0) => Math.round(performance.now() - t0);
const paraBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
const paraFicheiro = (blob) => new File([blob], 'fatura.jpg', { type: 'image/jpeg' });

// Recorta a imagem original pela bounding box (com uma pequena margem) e
// devolve um canvas. Usado quando não há 4 cantos bons para o warp.
function recortarBBox(img, r, pad = 8) {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  const w = Math.min(img.width - x, r.width + 2 * pad);
  const h = Math.min(img.height - y, r.height + 2 * pad);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvas;
}

// `onInfo` (opcional) recebe um diagnóstico do que a digitalização fez — para se
// PERCEBER se corrigiu a perspetiva (`dewarped`), apenas recortou (`recortado`),
// ou caiu para a original (e porquê). `cobertura` = % da imagem que o resultado
// ocupa (~100% = praticamente nada a recortar/corrigir).
export async function digitalizar(file, onInfo) {
  const info = (o) => {
    try {
      console.log('[scan]', JSON.stringify(o));
      onInfo?.(o);
    } catch {
      /* noop */
    }
  };
  if (!file || !file.type?.startsWith('image/')) {
    info({ dewarped: false, motivo: 'não-imagem' });
    return file;
  }
  let mat;
  const t0 = performance.now();
  try {
    await carregarOpenCV();
    const { default: Jscanify } = await import('./vendor/jscanify.js');
    const scanner = new Jscanify();
    const img = await ficheiroParaImagem(file);
    const cv = window.cv;
    mat = cv.imread(img);
    const contour = scanner.findPaperContour(mat);
    if (!contour) {
      info({ dewarped: false, motivo: 'sem contorno', ms: desde(t0) });
      return file;
    }

    const areaImg = img.width * img.height;
    const r = cv.boundingRect(contour); // sempre disponível, para o recorte
    const bboxPct = areaImg ? Math.round((100 * (r.width * r.height)) / areaImg) : null;

    // 1) Tentar correção de perspetiva com os 4 cantos.
    const c = scanner.getCornerPoints(contour);
    const temCantos =
      c && c.topLeftCorner && c.topRightCorner && c.bottomLeftCorner && c.bottomRightCorner;
    if (temCantos) {
      const w = Math.round(
        Math.max(dist(c.topLeftCorner, c.topRightCorner), dist(c.bottomLeftCorner, c.bottomRightCorner)),
      );
      const h = Math.round(
        Math.max(dist(c.topLeftCorner, c.bottomLeftCorner), dist(c.topRightCorner, c.bottomRightCorner)),
      );
      if (w > 60 && h > 60) {
        const cobertura = areaImg ? Math.round((100 * (w * h)) / areaImg) : null;
        const canvas = scanner.extractPaper(img, w, h, c);
        const blob = await paraBlob(canvas);
        info({ dewarped: true, w, h, cobertura, original: `${img.width}×${img.height}`, ms: desde(t0) });
        return blob ? paraFicheiro(blob) : file;
      }
    }

    // 2) Sem cantos bons → recortar pela bounding box, se valer a pena
    //    (contorno plausível e que não seja já quase a imagem toda).
    if (r.width > 60 && r.height > 60 && bboxPct != null && bboxPct < 92) {
      const canvas = recortarBBox(img, r);
      const blob = await paraBlob(canvas);
      info({ dewarped: false, recortado: true, cobertura: bboxPct, ms: desde(t0) });
      return blob ? paraFicheiro(blob) : file;
    }

    // 3) Nada a fazer com proveito → original.
    info({
      dewarped: false,
      motivo: temCantos ? 'contorno ocupa a imagem toda' : 'sem cantos',
      cobertura: bboxPct,
      ms: desde(t0),
    });
    return file;
  } catch (e) {
    info({ dewarped: false, motivo: 'erro: ' + (e?.message || e) });
    return file; // qualquer erro → envia a original
  } finally {
    try {
      mat?.delete();
    } catch {
      /* noop */
    }
  }
}

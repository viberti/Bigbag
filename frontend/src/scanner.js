// Digitalização de documento no browser (jscanify + OpenCV.js): detecta as
// bordas do talão e corrige a perspectiva (achata) antes do upload.
// OpenCV.js (~8MB) é carregado sob demanda, só no 1º uso. Qualquer falha →
// devolve o ficheiro original (nunca quebra o upload).

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

// `onInfo` (opcional) recebe um diagnóstico do que a digitalização fez — para se
// PERCEBER se o jscanify correu, ou caiu para a original (e porquê). `cobertura`
// = % da imagem que o contorno detetado ocupa: ~100% = sem perspetiva a corrigir.
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
      info({ dewarped: false, motivo: 'sem contorno', ms: Math.round(performance.now() - t0) });
      return file;
    }
    const c = scanner.getCornerPoints(contour);
    if (!c?.topLeftCorner) {
      info({ dewarped: false, motivo: 'sem cantos' });
      return file;
    }
    const w = Math.round(Math.max(dist(c.topLeftCorner, c.topRightCorner), dist(c.bottomLeftCorner, c.bottomRightCorner)));
    const h = Math.round(Math.max(dist(c.topLeftCorner, c.bottomLeftCorner), dist(c.topRightCorner, c.bottomRightCorner)));
    const cobertura = img.width && img.height ? Math.round((100 * (w * h)) / (img.width * img.height)) : null;
    if (!(w > 60 && h > 60)) {
      info({ dewarped: false, motivo: 'contorno implausível', w, h });
      return file;
    }
    const canvas = scanner.extractPaper(img, w, h, c);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    info({ dewarped: true, w, h, cobertura, original: `${img.width}×${img.height}`, ms: Math.round(performance.now() - t0) });
    return blob ? new File([blob], 'fatura.jpg', { type: 'image/jpeg' }) : file;
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

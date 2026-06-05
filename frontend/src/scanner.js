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

export async function digitalizar(file) {
  if (!file || !file.type?.startsWith('image/')) return file; // PDF/outros: passa direto
  let mat;
  try {
    await carregarOpenCV();
    const { default: Jscanify } = await import('./vendor/jscanify.js');
    const scanner = new Jscanify();
    const img = await ficheiroParaImagem(file);
    const cv = window.cv;
    mat = cv.imread(img);
    const contour = scanner.findPaperContour(mat);
    if (!contour) return file;
    const c = scanner.getCornerPoints(contour);
    if (!c?.topLeftCorner) return file;
    const w = Math.round(Math.max(dist(c.topLeftCorner, c.topRightCorner), dist(c.bottomLeftCorner, c.bottomRightCorner)));
    const h = Math.round(Math.max(dist(c.topLeftCorner, c.bottomLeftCorner), dist(c.topRightCorner, c.bottomRightCorner)));
    if (!(w > 60 && h > 60)) return file; // contorno implausível → original
    const canvas = scanner.extractPaper(img, w, h, c);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    return blob ? new File([blob], 'fatura.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file; // qualquer erro → envia a original
  } finally {
    try {
      mat?.delete();
    } catch {
      /* noop */
    }
  }
}

// Digitalização de documento no browser (jscanify + OpenCV.js): detecta as
// bordas do talão e corrige a perspectiva (achata) antes do upload.
// OpenCV.js (~8MB) é carregado sob demanda, só no 1º uso. Qualquer falha →
// devolve o ficheiro original (nunca quebra o upload).
//
// Estratégia (do melhor para o pior, sempre que houver contorno):
//   1) 4 cantos plausíveis → correção de perspetiva (warp) — o ideal.
//   2) sem cantos para o warp → RECORTE pela bounding box do contorno.
//   3) sem contorno de todo → foto original.

// OpenCV.js é alojado por nós (mesma origem, em /vendor/opencv.js) — assim não
// depende do CDN do OpenCV (que removeu versões e nos partiu o URL antes) e
// funciona offline (PWA). O CDN fica só como fallback, com uma versão que existe.
const OPENCV_FONTES = ['/vendor/opencv.js', 'https://docs.opencv.org/4.9.0/opencv.js'];

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      const cv = window.cv;
      if (cv && cv.Mat) return resolve();
      // OpenCV.js pode inicializar o runtime de forma assíncrona.
      if (cv && typeof cv.then === 'function') return cv.then(() => resolve()).catch(reject);
      if (cv) cv.onRuntimeInitialized = () => resolve();
      else reject(new Error('OpenCV ausente após carregar ' + src));
    };
    s.onerror = () => reject(new Error('falha a carregar ' + src));
    document.head.appendChild(s);
  });
}

let cvPronto = null;
function carregarOpenCV() {
  if (cvPronto) return cvPronto;
  cvPronto = (async () => {
    if (window.cv && window.cv.Mat) return;
    let ultimoErro;
    for (const src of OPENCV_FONTES) {
      try {
        await carregarScript(src);
        return;
      } catch (e) {
        ultimoErro = e;
      }
    }
    cvPronto = null; // permite nova tentativa numa próxima digitalização
    throw ultimoErro || new Error('falha a carregar OpenCV');
  })();
  return cvPronto;
}

function ficheiroParaImagem(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // revogar logo após o load: a imagem já está descodificada (o canvas desenha-a
    // na mesma) e o blob-URL deixa de prender o ficheiro em memória.
    img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(img.src); reject(e); };
    img.src = URL.createObjectURL(file);
  });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const desde = (t0) => Math.round(performance.now() - t0);
const paraBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
const paraFicheiro = (blob) => new File([blob], 'fatura.jpg', { type: 'image/jpeg' });

// Fotos nativas chegam a 12+ MP (~50MB de Mat no OpenCV) — pesado e arriscado
// em memória no telemóvel. Reduz a fonte para no máximo MAX_LADO px no lado
// maior antes de processar. 2800px continua mais nítido que o scan ao vivo
// (~2528px) e é seguro. Devolve a própria imagem se já for pequena.
const MAX_LADO = 2800;
function reduzirFonte(img) {
  const maior = Math.max(img.width, img.height);
  if (maior <= MAX_LADO) return img;
  const escala = MAX_LADO / maior;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

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
    const fonte = reduzirFonte(img); // <= MAX_LADO px, seguro em memória
    const cv = window.cv;
    mat = cv.imread(fonte);
    const contour = scanner.findPaperContour(mat);
    if (!contour) {
      info({ dewarped: false, motivo: 'sem contorno', ms: desde(t0) });
      return file;
    }

    const areaImg = fonte.width * fonte.height;
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
        const canvas = scanner.extractPaper(fonte, w, h, c);
        const blob = await paraBlob(canvas);
        info({ dewarped: true, w, h, cobertura, original: `${fonte.width}×${fonte.height}`, ms: desde(t0) });
        return blob ? paraFicheiro(blob) : file;
      }
    }

    // 2) Sem cantos bons → recortar pela bounding box, se valer a pena
    //    (contorno plausível e que não seja já quase a imagem toda).
    if (r.width > 60 && r.height > 60 && bboxPct != null && bboxPct < 92) {
      const canvas = recortarBBox(fonte, r);
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

// Deteta o quadrilátero do papel num frame (canvas/imagem já desenhado) e
// devolve os 4 cantos em coordenadas da fonte, ou null. Leve, para o realce ao
// vivo do contorno sobre o feed da câmara (chamado a poucos fps). Converte para
// cinzento antes do Canny (o findPaperContour corre Canny direto na imagem) — é
// o que torna a deteção fiável, sobretudo em frames pequenos. Nunca lança.
// Ordena 4 pontos em {topLeft, topRight, bottomRight, bottomLeft} pelo método
// soma/diferença (robusto à ordem que o approxPolyDP devolve).
function ordenarCantos(p) {
  const soma = [...p].sort((a, b) => a.x + a.y - (b.x + b.y));
  const dif = [...p].sort((a, b) => a.y - a.x - (b.y - b.x));
  return { topLeftCorner: soma[0], bottomRightCorner: soma[3], topRightCorner: dif[0], bottomLeftCorner: dif[3] };
}

export let detStage = '-'; // marcador de etapa (diagnóstico)
// Deteta o talão num frame. Em vez do Canny-maior-contorno do jscanify (que
// agarra a moldura/textura do fundo), isola a região CLARA (o papel) por
// threshold de Otsu e pega no maior contorno claro — robusto para talão sobre
// mesa escura. Devolve os 4 cantos (via getCornerPoints) ou null.
export async function detectarPapel(fonte) {
  let src, gray, bin, contours, hier, best;
  try {
    detStage = 'cv';
    if (!window.cv?.Mat) await carregarOpenCV();
    detStage = 'import';
    const { default: Jscanify } = await import('./vendor/jscanify.js');
    const scanner = new Jscanify();
    const cv = window.cv;
    detStage = 'prep';
    src = cv.imread(fonte);
    gray = new cv.Mat();
    bin = new cv.Mat();
    contours = new cv.MatVector();
    hier = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    detStage = 'thresh';
    cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); // papel claro → branco
    detStage = 'contours';
    cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const total = fonte.width * fonte.height;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const ct = contours.get(i);
      const a = cv.contourArea(ct);
      if (a > bestArea) {
        bestArea = a;
        if (best) best.delete();
        best = ct;
      } else ct.delete();
    }
    detStage = 'eval';
    // rejeita: nada, pequeno demais (<8%), ou quase o ecrã todo (>92% = fundo/moldura)
    if (!best || bestArea < total * 0.08 || bestArea > total * 0.92) {
      detStage = 'rej';
      return null;
    }
    // EXIGE um quadrilátero limpo (4 vértices, convexo) — distingue um talão
    // retangular de um borrão de reflexos. Sem isso, não há "lock" (não engana).
    detStage = 'approx';
    const approx = new cv.Mat();
    try {
      const peri = cv.arcLength(best, true);
      cv.approxPolyDP(best, approx, 0.03 * peri, true);
      if (approx.rows !== 4 || !cv.isContourConvex(approx)) {
        detStage = 'naoQuad(' + approx.rows + ')';
        return null;
      }
      const p = [];
      for (let i = 0; i < 4; i++) p.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
      detStage = 'done';
      return ordenarCantos(p);
    } finally {
      approx.delete();
    }
  } catch (e) {
    detStage = 'err:' + String(e?.message || e).slice(0, 24);
    return null;
  } finally {
    try {
      src?.delete();
      gray?.delete();
      bin?.delete();
      contours?.delete();
      hier?.delete();
      best?.delete();
    } catch {
      /* noop */
    }
  }
}

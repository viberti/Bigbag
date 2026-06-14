// LEITOR de código de barras ao vivo — a MESMA função PROVADA que a v1 usa
// (App.jsx, 2026-06-13: corrige o caso "funciona no /diag mas não na app" do
// telemóvel da Sue, funciona em vários Androids). Copiada VERBATIM para um módulo
// para a v2 reutilizar SEM tocar na v1. Não reescrever — se mudar, mudar nos dois
// (ou, mais tarde, fazer a v1 importar daqui e ficar fonte única).
//
//  (a) usa 1280×720 — a alta resolução (1920) falhava em vários Androids;
//  (b) PREFERE o BarcodeDetector NATIVO (mais robusto/rápido que o ZXing) e só cai
//      no ZXing como alternativa;
//  (c) gere o getUserMedia nós (como o /diag) em vez do decodeFromConstraints.
// Devolve { stop, getTrack }. onCode recebe só dígitos (≥8). onErro se a câmara falhar.
export async function lerCodigoBarras(videoEl, onCode, onErro, { continuo = false } = {}) {
  let parado = false, stream = null, zx = null, raf = 0, ultimo = '', ultimoT = 0, cand = '', candN = 0;
  const stop = () => {
    parado = true; cancelAnimationFrame(raf);
    try { zx?.stop(); } catch { /* noop */ }
    if (stream) stream.getTracks().forEach((t) => t.stop());
  };
  const checksumOk = (c) => {
    if (![8, 12, 13].includes(c.length)) return true;
    const d = c.split('').map(Number); const chk = d.pop();
    let s = 0; for (let i = d.length - 1, k = 0; i >= 0; i--, k++) s += d[i] * (k % 2 === 0 ? 3 : 1);
    return (10 - (s % 10)) % 10 === chk;
  };
  const emit = (bruto) => {
    if (parado) return;
    const c = String(bruto).replace(/\D/g, '');
    if (c.length < 8 || !checksumOk(c)) return;
    if (c === cand) candN++; else { cand = c; candN = 1; }
    if (candN < 2) return;
    if (continuo) {
      const agora = Date.now();
      if (c === ultimo && agora - ultimoT < 2500) return;
      ultimo = c; ultimoT = agora;
      try { navigator.vibrate?.(40); } catch { /* noop */ }
      onCode(c); return;
    }
    stop(); try { navigator.vibrate?.(60); } catch { /* noop */ }
    onCode(c);
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) { onErro?.(e); return { stop, getTrack: () => null }; }
  videoEl.srcObject = stream;
  try { await videoEl.play(); } catch { /* autoplay */ }
  let nativo = false;
  if ('BarcodeDetector' in window) {
    try {
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      const quer = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => fmts.includes(f));
      if (quer.length) {
        const det = new window.BarcodeDetector({ formats: quer });
        nativo = true;
        const loop = async () => {
          if (parado) return;
          if (videoEl.readyState >= 2) { try { const r = await det.detect(videoEl); if (r.length) emit(r[0].rawValue); } catch { /* frame */ } }
          if (!parado) raf = requestAnimationFrame(loop);
        };
        loop();
      }
    } catch { /* cai no zxing */ }
  }
  if (!nativo) {
    try {
      const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      const hints = new Map();
      hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E]);
      hints.set(lib.DecodeHintType.TRY_HARDER, true);
      zx = await new BrowserMultiFormatReader(hints).decodeFromVideoElement(videoEl, (r) => { if (r) emit(r.getText()); });
    } catch (e) { onErro?.(e); }
  }
  return { stop, getTrack: () => stream?.getVideoTracks?.()[0] || null };
}

// Página de DIAGNÓSTICO do scanner (rota /diag) — corre DENTRO da app (mesmo
// service worker, origem e permissões que o scanner real), ao contrário de uma
// página solta que o SW interceta. Testa BarcodeDetector, getUserMedia, brilho
// do frame (canvas) e deteção ao vivo. Tudo client-side; mostra o User-Agent
// para comparar telemóveis. Porte fiel de scanner-diag.html.
import React, { useEffect, useRef } from 'react';

export default function DiagScanner() {
  const vRef = useRef(null), cRef = useRef(null), logRef = useRef(null), statusRef = useRef(null);

  useEffect(() => {
    const v = vRef.current, c = cRef.current, statusEl = statusRef.current, logEl = logRef.current;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    let stream = null, devices = [], devIdx = 0, detector = null, busy = false, raf = 0, parado = false;
    const pills = {};
    const lines = [];

    const log = (m) => {
      const t = new Date().toISOString().substr(11, 8);
      lines.push('[' + t + '] ' + m); if (lines.length > 60) lines.shift();
      logEl.textContent = lines.join('\n');
    };
    const setPill = (key, label, cls) => {
      if (!pills[key]) { pills[key] = document.createElement('span'); pills[key].className = 'dg-pill'; pills[key].style.marginRight = '6px'; statusEl.appendChild(pills[key]); }
      pills[key].textContent = label; pills[key].className = 'dg-pill ' + cls;
    };
    const onErr = (m, _s, l, col) => log('JS ERROR: ' + m + ' @' + l + ':' + col);
    const onRej = (e) => log('PROMISE REJECT: ' + (e.reason && e.reason.message || e.reason));
    window.addEventListener('error', (e) => onErr(e.message, 0, e.lineno, e.colno));
    window.addEventListener('unhandledrejection', onRej);
    log('User-Agent: ' + navigator.userAgent);

    (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const fmts = await window.BarcodeDetector.getSupportedFormats();
          log('BarcodeDetector existe. Formatos: ' + fmts.join(', '));
          if (fmts.length) { detector = new window.BarcodeDetector({ formats: fmts }); setPill('bd', 'BarcodeDetector: SIM', 'ok'); }
          else setPill('bd', 'BarcodeDetector: 0 formatos', 'warn');
        } catch (e) { log('BarcodeDetector erro: ' + e.message); setPill('bd', 'BarcodeDetector: erro', 'bad'); }
      } else {
        setPill('bd', 'BarcodeDetector: NÃO', 'bad');
        log('BarcodeDetector NÃO existe neste browser (provável WebView/browser antigo → o scanner usa o ZXing como alternativa).');
      }
    })();

    const listCams = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        devices = all.filter((d) => d.kind === 'videoinput');
        log('Câmaras encontradas (' + devices.length + '):');
        devices.forEach((d, i) => log('  [' + i + '] ' + (d.label || '(sem label)')));
      } catch (e) { log('enumerateDevices erro: ' + e.message); }
    };

    const frameBrightness = () => {
      const w = 160, h = 120; c.width = w; c.height = h;
      try { ctx.drawImage(v, 0, 0, w, h); } catch (e) { log('drawImage falhou: ' + e.message); return null; }
      let data;
      try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { log('getImageData falhou (secure surface?): ' + e.message); return -1; }
      let sum = 0; for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      return sum / (data.length / 4);
    };

    const loop = async () => {
      if (parado) return;
      if (v.readyState >= 2) {
        const b = frameBrightness();
        if (b === null) setPill('frame', 'Canvas: drawImage FALHA', 'bad');
        else if (b < 0) setPill('frame', 'Canvas: bloqueado', 'bad');
        else if (b < 8) setPill('frame', 'Frame PRETO (' + b.toFixed(1) + ')', 'bad');
        else setPill('frame', 'Frame OK (brilho ' + b.toFixed(0) + ')', 'ok');
        if (detector && !busy) {
          busy = true;
          try {
            let res = await detector.detect(v);
            if (!res.length && c.width) res = await detector.detect(c);
            if (res.length) { const r = res[0]; setPill('det', 'DETETOU: ' + r.format, 'ok'); log('>>> CÓDIGO: ' + r.rawValue + '  (' + r.format + ')'); }
            else setPill('det', 'A procurar…', 'warn');
          } catch (e) { setPill('det', 'detect erro', 'bad'); log('detect erro: ' + e.message); }
          busy = false;
        }
      }
      raf = requestAnimationFrame(loop);
    };

    const start = async (deviceId) => {
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      const constraints = { audio: false, video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
      log('getUserMedia: ' + JSON.stringify(constraints.video));
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch (e) { log('getUserMedia FALHOU: ' + e.name + ' — ' + e.message); setPill('cam', 'Câmara: erro (' + e.name + ')', 'bad'); return; }
      v.srcObject = stream;
      const track = stream.getVideoTracks()[0]; const s = track.getSettings();
      log('Câmara ativa: "' + (track.label || '?') + '"  ' + s.width + 'x' + s.height + '  facing=' + s.facingMode);
      setPill('cam', 'Câmara: OK ' + s.width + 'x' + s.height, 'ok');
      await listCams();
      v.onloadedmetadata = () => v.play().then(() => { log('vídeo a reproduzir'); loop(); }).catch((e) => log('play() falhou: ' + e.message));
    };

    const btnSwitch = document.getElementById('dg-switch');
    const btnRestart = document.getElementById('dg-restart');
    const onSwitch = async () => { if (!devices.length) await listCams(); if (!devices.length) { log('sem câmaras para trocar'); return; } devIdx = (devIdx + 1) % devices.length; log('--- a trocar para câmara [' + devIdx + '] ---'); start(devices[devIdx].deviceId); };
    const onRestart = () => start();
    btnSwitch.addEventListener('click', onSwitch);
    btnRestart.addEventListener('click', onRestart);

    start();

    return () => {
      parado = true; cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      window.removeEventListener('unhandledrejection', onRej);
      btnSwitch.removeEventListener('click', onSwitch);
      btnRestart.removeEventListener('click', onRestart);
    };
  }, []);

  return (
    <div className="dg">
      <style>{`
        .dg{margin:0;padding:12px;font:14px/1.45 -apple-system,Roboto,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;box-sizing:border-box}
        .dg h1{font-size:16px;margin:0 0 8px}
        .dg video{width:100%;max-height:38vh;background:#000;border-radius:8px;object-fit:cover}
        .dg .dg-row{display:flex;gap:8px;align-items:flex-start;margin:10px 0;flex-wrap:wrap}
        .dg .dg-box{flex:1;min-width:140px}
        .dg canvas{width:100%;background:#000;border:1px solid #30363d;border-radius:8px}
        .dg .dg-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:600;font-size:13px}
        .dg .ok{background:#1a7f37;color:#fff}.dg .bad{background:#a40e26;color:#fff}.dg .warn{background:#9a6700;color:#fff}
        .dg button{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:10px 14px;font-size:14px}
        .dg pre{background:#010409;border:1px solid #30363d;border-radius:8px;padding:8px;white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:34vh;overflow:auto}
        .dg .k{color:#7d8590;font-size:12px}
      `}</style>
      <h1>Diagnóstico do Scanner (dentro da app)</h1>
      <video ref={vRef} playsInline muted autoPlay />
      <div className="dg-row">
        <button id="dg-switch" type="button">Trocar câmara</button>
        <button id="dg-restart" type="button">Reiniciar câmara</button>
      </div>
      <div className="dg-row">
        <div className="dg-box">
          <div className="k">Frame enviado ao descodificador (via canvas):</div>
          <canvas ref={cRef} />
        </div>
      </div>
      <div className="dg-row" ref={statusRef} />
      <pre ref={logRef} />
    </div>
  );
}

/* BigBag — App icon (várias direções).
   APPICON(variant, size) -> SVG string (rounded-square app tile).
   variants: 'emerald' | 'spotlight' | 'cream' | 'night'
   Mascote-saco com carinha + spark, sobre fundos com profundidade. */
(function(){
  let uid=0;
  function bag(opts){
    // corpo do saco no viewBox 0..100 (centrado), cor configurável
    const body=opts.body, fold=opts.fold, ink=opts.ink, spark=opts.spark, hl=opts.hl||"rgba(255,255,255,.18)";
    return `
      <!-- asas -->
      <path d="M37 35 C37 19, 63 19, 63 35" stroke="${fold}" stroke-width="5.4"
            stroke-linecap="round" fill="none"/>
      <!-- corpo -->
      <path d="M24.5 33 H75.5 a5 5 0 0 1 4.98 5.44 l-3.3 39.6 A8 8 0 0 1 73.2 85 H26.8
               a8 8 0 0 1-7.97-7.36 l-3.3-39.6 A5 5 0 0 1 24.5 33 Z" fill="${body}"/>
      <!-- gloss no corpo -->
      <path d="M24.5 33 H75.5 a5 5 0 0 1 4.98 5.44 l-3.3 39.6 A8 8 0 0 1 73.2 85 H26.8
               a8 8 0 0 1-7.97-7.36 l-3.3-39.6 A5 5 0 0 1 24.5 33 Z" fill="${hl}"
            style="mix-blend-mode:overlay" transform="translate(0,-2)"/>
      <!-- dobra -->
      <path d="M24.5 33 H75.5 a5 5 0 0 1 4.98 5.44 l-.62 7.4 A3 3 0 0 1 76.9 48.8 H23.1
               A3 3 0 0 1 20.14 45.84 l-.62-7.4 A5 5 0 0 1 24.5 33 Z" fill="${fold}"/>
      <!-- olhos -->
      <circle cx="41" cy="63" r="3.4" fill="${ink}"/>
      <circle cx="59" cy="63" r="3.4" fill="${ink}"/>
      <!-- sorriso -->
      <path d="M39.6 71.5 C44 78, 56 78, 60.4 71.5" stroke="${ink}"
            stroke-width="4" stroke-linecap="round" fill="none"/>
      <!-- spark -->
      <path d="M73 20 L75 25.4 L80.4 27.4 L75 29.4 L73 34.8 L71 29.4 L65.6 27.4 L71 25.4 Z" fill="${spark}"/>`;
  }

  function APPICON(variant, size){
    size=size||128; const id="ai"+(uid++);
    const r=23; // raio % -> usamos rect rounded em viewBox 100
    let bg="", b={}, ring="";
    if(variant==="emerald"){
      bg=`<defs>
            <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#2fe089"/><stop offset=".5" stop-color="#15b56f"/><stop offset="1" stop-color="#0c7d63"/>
            </linearGradient>
            <radialGradient id="h${id}" cx="30%" cy="20%" r="80%">
              <stop offset="0" stop-color="rgba(255,255,255,.45)"/><stop offset="45%" stop-color="rgba(255,255,255,0)"/>
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" rx="${r}" fill="url(#g${id})"/>
          <rect x="0" y="0" width="100" height="100" rx="${r}" fill="url(#h${id})"/>`;
      b={body:"#fff7ec",fold:"#ffe6c2",ink:"#0c4b39",spark:"#eafff4",hl:"rgba(255,180,90,.25)"};
    } else if(variant==="spotlight"){
      bg=`<defs>
            <radialGradient id="g${id}" cx="50%" cy="38%" r="75%">
              <stop offset="0" stop-color="#1b8f63"/><stop offset="55%" stop-color="#0c3b32"/><stop offset="100%" stop-color="#06201d"/>
            </radialGradient>
            <radialGradient id="s${id}" cx="50%" cy="40%" r="42%">
              <stop offset="0" stop-color="rgba(70,222,150,.85)"/><stop offset="100%" stop-color="rgba(70,222,150,0)"/>
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" rx="${r}" fill="url(#g${id})"/>
          <rect x="0" y="0" width="100" height="100" rx="${r}" fill="url(#s${id})"/>`;
      b={body:"#eafff3",fold:"#bdf3d4",ink:"#0a3b2c",spark:"#ffffff",hl:"rgba(120,255,190,.3)"};
    } else if(variant==="cream"){
      bg=`<defs>
            <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#13261d"/><stop offset="1" stop-color="#0c1a14"/>
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" rx="${r}" fill="url(#g${id})"/>
          <rect x="3.5" y="3.5" width="93" height="93" rx="${r-3}" fill="none" stroke="rgba(46,196,110,.35)" stroke-width="1.4"/>`;
      b={body:"#46d488",fold:"#34c178",ink:"#06281c",spark:"#eafff4",hl:"rgba(255,255,255,.16)"};
    } else { // night — neon glow
      bg=`<defs>
            <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#0c1411"/><stop offset="1" stop-color="#06100c"/>
            </linearGradient>
            <filter id="f${id}" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.4"/>
            </filter>
          </defs>
          <rect x="0" y="0" width="100" height="100" rx="${r}" fill="url(#g${id})"/>`;
      b={body:"#37f29a",fold:"#23d585",ink:"#04140d",spark:"#d9fff0",hl:"rgba(120,255,200,.25)"};
    }
    const glow = variant==="night"
      ? `<g filter="url(#f${id})" opacity=".9">${bag(b)}</g>` : "";
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg" style="display:block">
      ${bg}${glow}${bag(b)}</svg>`;
  }
  window.APPICON=APPICON;
  window.APPICON_VARIANTS=["emerald","spotlight","cream","night"];
})();

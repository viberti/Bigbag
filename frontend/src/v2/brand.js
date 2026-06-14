// BigBag v2 — mascote-saco do handoff "cartoon". BIGBAG_MARK({size,chip}) -> SVG.
let uid = 0;
export function BIGBAG_MARK(o = {}) {
  const size = o.size || 48;
  const chip = !!o.chip;
  const id = 'bb' + (uid++);
  const G = `grad${id}`, GH = `gh${id}`;
  const top = '#41de86', bottom = '#16a06a', foldT = '#37c97a', foldB = '#159e76';
  const ink = '#0c2b22', spark = '#eafff4';
  const defs = `<defs>
      <linearGradient id="${G}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
      <linearGradient id="${GH}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${foldT}"/><stop offset="1" stop-color="${foldB}"/></linearGradient>
    </defs>`;
  const chipBg = chip ? `<rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="#1b2830" stroke="rgba(255,255,255,.08)"/>` : '';
  const inset = chip ? 'translate(7,7) scale(0.71)' : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bigbag" style="display:block">
    ${defs}${chipBg}
    <g transform="${inset}">
      <path d="M16 16 C16 8.5, 32 8.5, 32 16" stroke="${foldB}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
      <path d="M10.5 15 H37.5 a2.5 2.5 0 0 1 2.49 2.72 l-1.74 21 A4 4 0 0 1 34.26 42.4 H13.74 a4 4 0 0 1-3.98-3.68 l-1.75-21 A2.5 2.5 0 0 1 10.5 15 Z" fill="url(#${G})"/>
      <path d="M10.5 15 H37.5 a2.5 2.5 0 0 1 2.49 2.72 l-.36 4.3 A1.6 1.6 0 0 1 38.04 23.7 H9.96 A1.6 1.6 0 0 1 8.37 22.02 l-.36-4.3 A2.5 2.5 0 0 1 10.5 15 Z" fill="url(#${GH})"/>
      <circle cx="20" cy="31" r="1.9" fill="${ink}"/><circle cx="28" cy="31" r="1.9" fill="${ink}"/>
      <path d="M19.4 35.6 C21.6 38.8, 26.4 38.8, 28.6 35.6" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <path d="M34.5 9.5 L35.4 12 L38 12.9 L35.4 13.8 L34.5 16.3 L33.6 13.8 L31 12.9 L33.6 12 Z" fill="${spark}"/>
    </g>
  </svg>`;
}

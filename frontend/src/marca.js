// Marca + ícones do Bigbag (handoff do designer). Funções que devolvem string
// SVG; usadas via dangerouslySetInnerHTML nos wrappers <Mark>/<Ico> do App.

let uid = 0;
// Mascote-saco com carinha + spark (toque tech). chip:true desenha o fundo
// arredondado (avatar / app icon).
export function MARK(o = {}) {
  const size = o.size || 48;
  const chip = !!o.chip;
  const id = 'bb' + uid++;
  const G = `grad${id}`,
    GH = `gh${id}`;
  const top = '#41de86',
    bottom = '#16a06a',
    foldT = '#37c97a',
    foldB = '#159e76',
    ink = '#0c2b22',
    spark = '#eafff4';
  const defs = `<defs>
      <linearGradient id="${G}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
      <linearGradient id="${GH}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${foldT}"/><stop offset="1" stop-color="${foldB}"/></linearGradient>
    </defs>`;
  const chipBg = chip
    ? `<rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="#1b2830" stroke="rgba(255,255,255,.08)"/>`
    : '';
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

// Ícones de linha (24px, stroke 1.8, currentColor).
const P = {
  sync: `<path d="M20 11a8 8 0 0 0-13.7-4.5L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 13.7 4.5L20 15"/><path d="M20 19v-4h-4"/>`,
  cart: `<circle cx="9.5" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2.2l1.6 11.2a1.5 1.5 0 0 0 1.5 1.3h9.1a1.5 1.5 0 0 0 1.47-1.2L21 8H6.2"/>`,
  camera: `<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H7l1.2-1.7A1.5 1.5 0 0 1 9.4 4.6h5.2a1.5 1.5 0 0 1 1.2.7L17 7h1.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.2"/>`,
  more: `<circle cx="5.5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18.5" cy="12" r="1.5"/>`,
  send: `<path d="M5.5 12L20 5l-4.2 14.5a.7.7 0 0 1-1.3.1l-3-6.2-6.2-3a.7.7 0 0 1 .2-1.4z"/><path d="M11.5 13.5L20 5"/>`,
  receipt: `<path d="M6 3h12v18l-2.2-1.4L13.6 21 11 19.6 8.4 21 6 19.6z"/><path d="M9.5 8h5M9.5 12h5"/>`,
  chart: `<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l3.5-4 3 2.5L20 7"/>`,
  spark: `<path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>`,
  store: `<path d="M4 9l1.3-4.2A1.5 1.5 0 0 1 6.7 3.7h10.6a1.5 1.5 0 0 1 1.4 1.1L20 9"/><path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9"/><path d="M4 9h16"/>`,
  usual: `<path d="M3.4 8.5l1.2 1.2 2.5-2.7"/><path d="M9.4 8.3H15.5"/><path d="M3.4 13.3l1.2 1.2 2.5-2.7"/><path d="M9.4 13.1H17.5"/><path d="M3.4 18.1l1.2 1.2 2.5-2.7"/><path d="M9.4 17.9H14"/><path d="M19.7 3.6l.62 1.78 1.78.62-1.78.62-.62 1.78-.62-1.78-1.78-.62 1.78-.62z"/>`,
  plus: `<path d="M12 5.5v13M5.5 12h13"/>`,
  check: `<path d="M5 12.5l4.2 4.2L19 7"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="2.5"/>`,
};

export function ICON(name, o = {}) {
  const size = o.size || 24;
  const stroke = o.stroke != null ? o.stroke : 1.8;
  const inner = P[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="display:block" aria-hidden="true">${inner}</svg>`;
}

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
  // mais opções (vertical / kebab)
  kebab: `<circle cx="12" cy="5" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.9" fill="currentColor" stroke="none"/>`,
  // sair / logout
  logout: `<path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8"/><path d="M16 16l4-4-4-4"/><path d="M20 12H10"/>`,
  // lista de compras (clipboard com itens marcados) — botão Lista do cabeçalho
  list: `<path d="M9 4.2H7.4A2.4 2.4 0 0 0 5 6.6V18.6A2.4 2.4 0 0 0 7.4 21h9.2A2.4 2.4 0 0 0 19 18.6V6.6A2.4 2.4 0 0 0 16.6 4.2H15"/><rect x="9" y="2.6" width="6" height="3.4" rx="1.2"/><path d="M8.4 10.6l1.2 1.2 2.1-2.2"/><path d="M14 10.6h2.4"/><path d="M8.4 15.4l1.2 1.2 2.1-2.2"/><path d="M14 15.4h2.4"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5"/><path d="M12 7.8v.01"/>`,
  despensa: `<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M12 3.5v17"/><path d="M4.5 9.5h15M4.5 14.5h15"/><path d="M10 6.3v1.4M14 6.3v1.4"/>`,
  gastos: `<circle cx="12" cy="12" r="8.5"/><path d="M14.7 9.3a3.4 3.4 0 1 0 0 5.4"/><path d="M7.8 11.2h4.4M7.8 13h4"/>`,
  chevron: `<path d="M9 6l6 6-6 6"/>`,
  barras: `<path d="M4 6v12M7 6v12M10 6v12M13.5 6v12M17 6v12M20 6v12"/>`,
  // código de barras dentro de moldura de scanner — "scan deste produto" (distinto
  // do `barras` simples do rodapé e do `scan` de documento).
  escanear: `<path d="M4 8V6.4A1.4 1.4 0 0 1 5.4 5H7"/><path d="M17 5h1.6A1.4 1.4 0 0 1 20 6.4V8"/><path d="M20 16v1.6a1.4 1.4 0 0 1-1.4 1.4H17"/><path d="M7 19H5.4A1.4 1.4 0 0 1 4 17.6V16"/><path d="M8 8.5v7M10.5 8.5v7M13 8.5v7M15.5 8.5v7"/>`,
  // balança de pratos — "comparar produtos" (rodapé).
  comparar: `<path d="M12 3.5v15"/><path d="M8.5 20.5h7"/><path d="M5 6.5h14"/><path d="M5 6.5l-2.3 5.2M5 6.5l2.3 5.2"/><path d="M2.2 11.9a2.9 2.9 0 0 0 5.6 0"/><path d="M19 6.5l-2.3 5.2M19 6.5l2.3 5.2"/><path d="M16.2 11.9a2.9 2.9 0 0 0 5.6 0"/>`,
  // partilhar (nós ligados) — envio por WhatsApp de fichas/comparações.
  partilhar: `<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="5.8" r="2.5"/><circle cx="17.5" cy="18.2" r="2.5"/><path d="M8.3 10.8l6.9-3.8M8.3 13.2l6.9 3.8"/>`,
  // pessoa — lista individual do membro.
  pessoa: `<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>`,
  luz: `<path d="M13 2 5 13h6l-1 9 9-12h-6z"/>`,
  voltar: `<path d="M15 5l-7 7 7 7"/>`,
  scan: `<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M4 12h16"/>`,
  galeria: `<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M4 16.5l4.5-4 3 2.5L16 11l4 4"/>`,
  ficheiro: `<path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V9z"/><path d="M13 3.5V9h5.5"/>`,
  notas: `<rect x="8" y="3.5" width="10.5" height="13" rx="1.5"/><rect x="5.5" y="7.5" width="10.5" height="13" rx="1.5"/><path d="M8.2 11.5h5M8.2 14.5h5M8.2 17.5h3"/>`,
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

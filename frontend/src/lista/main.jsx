// Entrada da app "Lista" (/lista). Troca o manifesto do PWA pelo da Lista ANTES de o
// browser avaliar a instalação → instala-se como app própria (nome, ícone, âmbito /lista),
// separada do BigBag. O service worker é o mesmo (mesma origem).
import React from 'react';
import { createRoot } from 'react-dom/client';
import ListaApp from './ListaApp.jsx';

function meta(sel, criar) {
  let el = document.head.querySelector(sel);
  if (!el) { el = criar(); document.head.appendChild(el); }
  return el;
}
meta('link[rel="manifest"]', () => Object.assign(document.createElement('link'), { rel: 'manifest' })).href = '/lista.webmanifest';
meta('meta[name="theme-color"]', () => Object.assign(document.createElement('meta'), { name: 'theme-color' })).content = '#ffffff';
meta('link[rel="apple-touch-icon"]', () => Object.assign(document.createElement('link'), { rel: 'apple-touch-icon' })).href = '/lista-icons/lista-192.png';
meta('meta[name="apple-mobile-web-app-title"]', () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title' })).content = 'Lista';
document.title = 'Lista de compras';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ListaApp />
  </React.StrictMode>,
);

import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Versão da app, fonte de verdade no package.json, mostrada junto ao logo (verbatim
// — pode ter 4 partes). Estamos em fase BETA e re-baseámos para "0.0.90.x" (em vez
// de aproximar a 1.0): a major/minor ficam 0.0 e o contador útil é o 3.º segmento.
// Regra de incremento nesta fase:
//   4.º seg. (0.0.90.x) → correções e ajustes pequenos (bug fix, tweak de UI);
//   3.º seg. (0.0.x.0)  → funcionalidade nova (nova aba, novo endpoint, novo fluxo);
//   1.0.0.0 fica reservado para o marco de estabilização (longe).
// O PWA (autoUpdate) trata da cache; a versão é só informativa para o utilizador.
function versaoApp() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(versaoApp()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // O novo SW assume o controlo imediatamente (sem esperar fechar abas) e
        // limpa caches antigas — evita ficar preso numa versão antiga.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // OpenCV.js (~9MB) não entra no precache (não pesa no arranque); é
        // carregado sob demanda e fica em cache só depois do 1.º uso.
        globIgnores: ['**/vendor/opencv.js'],
        runtimeCaching: [
          {
            // HTML (navegação) sempre da rede quando online; cai para cache só
            // offline. Garante que um deploy novo aparece no próximo carregamento.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'html', networkTimeoutSeconds: 3, expiration: { maxEntries: 10 } },
          },
          {
            // OpenCV.js: cache-first após o 1.º download (offline a partir daí).
            urlPattern: ({ url }) => url.pathname === '/vendor/opencv.js',
            handler: 'CacheFirst',
            options: {
              cacheName: 'opencv',
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Bigbag',
        short_name: 'Bigbag',
        description: 'Histórico de preços de compras',
        theme_color: '#0c3b32',
        background_color: '#06201d',
        display: 'standalone',
        start_url: '/',
        // Ícone "Spotlight" (saco iluminado por holofote verde sobre fundo escuro).
        // SVG escalável + PNGs `any` (tile com cantos) + PNGs `maskable` (saco na
        // safe zone sobre fundo full-bleed, p/ o SO aplicar a sua máscara).
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/app-icons/bigbag-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/app-icons/bigbag-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/app-icons/bigbag-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/app-icons/bigbag-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Em produção o Apache faz proxy /api -> 4200; em dev, o Vite trata.
  server: { proxy: { '/api': 'http://127.0.0.1:4200' } },
});

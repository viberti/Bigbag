import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Versão da app em SEMVER MAJOR.MINOR.PATCH (ex.: "0.55.0"), fonte de verdade no
// package.json. Mostrada junto ao logo. Regra de incremento (estamos na major 0
// até estabilizar):
//   PATCH (0.55.x) → correções e ajustes pequenos (bug fix, tweak de UI);
//   MINOR (0.x.0)  → funcionalidade nova (nova aba, novo endpoint, novo fluxo);
//   MAJOR (x.0.0)  → marco grande / quebra (ex.: 1.0 quando estabilizar).
// O PWA (autoUpdate) trata da cache; a versão é só informativa para o utilizador.
function versaoApp() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
    const [maj = '0', min = '0', pat = '0'] = String(pkg.version || '0.0.0').split('.');
    return `${maj}.${min}.${pat}`;
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
        theme_color: '#1f2c33',
        background_color: '#0b141a',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  // Em produção o Apache faz proxy /api -> 4200; em dev, o Vite trata.
  server: { proxy: { '/api': 'http://127.0.0.1:4200' } },
});

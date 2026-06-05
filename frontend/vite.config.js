import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Versão injetada no build: hash curto do git + data. Mostrada junto ao logo
// para se perceber, num relance, se o PWA está em cache antigo.
function versaoBuild() {
  let hash = 'dev';
  try {
    hash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    /* sem git (ex.: tarball) → 'dev' */
  }
  const data = new Date().toISOString().slice(0, 10); // YYYY-MM-DD do build
  return `${data}·${hash}`;
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(versaoBuild()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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

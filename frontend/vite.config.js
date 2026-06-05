import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Bigbag',
        short_name: 'Bigbag',
        description: 'Histórico de preços de compras',
        theme_color: '#1f7a4d',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  // Em produção o Apache faz proxy /api -> 4200; em dev, o Vite trata.
  server: { proxy: { '/api': 'http://127.0.0.1:4200' } },
});

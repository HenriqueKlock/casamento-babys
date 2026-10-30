import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// O GitHub Pages serve o app em /casamento-babys/
const base = process.env.BASE_PATH ?? '/casamento-babys/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      // evento de uma noite: o convidado nunca vê aviso de atualização (o código congela antes da festa)
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Casamento Babys · Desafios',
        short_name: 'Babys',
        description: 'Desafios dos convidados do Casamento Babys',
        lang: 'pt-BR',
        id: base + 'app',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4EEE3',
        theme_color: '#F4EEE3',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: base + 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // fotos do mural: o caminho de cada foto nunca muda, então o celular guarda e não baixa de novo
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/public/fotos/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fotos',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});

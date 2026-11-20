import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

// GitHub Pages serves the app under /<repo>/; Docker and local preview serve it from /.
const base = process.env.KAPITAL_BASE ?? '/'

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0') },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@data': fileURLToPath(new URL('./src/data', import.meta.url)),
      '@web': fileURLToPath(new URL('./src/web', import.meta.url)),
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Kapitał – rodzinne finanse',
        short_name: 'Kapitał',
        description: 'Majątek, obligacje skarbowe, lokaty, akcje GPW i trendy sektorów – zrozumiale.',
        lang: 'pl',
        theme_color: '#0f3d3e',
        background_color: '#f4f1ea',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['data/**/*'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // market data changes daily → network first, offline from cache
            urlPattern: ({ url }) => url.pathname.includes('/data/') || url.pathname.includes('/api/data/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'kapital-data', networkTimeoutSeconds: 6, expiration: { maxEntries: 2000 } },
          },
        ],
      },
    }),
  ],
})

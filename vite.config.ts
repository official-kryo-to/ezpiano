import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets the same build work at a domain root (Vercel/Netlify) or a sub-path (GitHub Pages).
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ezpiano: learn any song',
        short_name: 'ezpiano',
        description: 'Type a song and learn it on piano with falling notes, letter notes and a wait-for-me mode.',
        theme_color: '#05060b',
        background_color: '#05060b',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        categories: ['music', 'education'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'bitmidi.com' && url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: { cacheName: 'midi-files', expiration: { maxEntries: 300 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'bitmidi.com' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'midi-search', networkTimeoutSeconds: 6, expiration: { maxEntries: 100 } },
          },
          {
            urlPattern: ({ url }) => url.hostname.endsWith('github.io') || url.hostname.includes('smpldsnds'),
            handler: 'CacheFirst',
            options: { cacheName: 'piano-samples', expiration: { maxEntries: 400 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30 } },
          },
        ],
      },
    }),
  ],
})

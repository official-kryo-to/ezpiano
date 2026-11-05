import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets the same build work at a domain root (Vercel/Netlify) or a sub-path (GitHub Pages).
const base = process.env.BASE_PATH ?? '/'

/** Dev server: same isolation headers the service worker adds in production (enables WASM threads). */
const isolationHeaders = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }

export default defineConfig({
  base,
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: {
    format: 'es',
    // onnxruntime-web's WASM files are emitted by Vite next to the chunk that loads them (self-hosted, no CDN).
    // Basic Pitch + TensorFlow.js get a stable name so they stay out of the precache (only used for non-piano audio).
    rollupOptions: {
      output: {
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes('@spotify/basic-pitch') || id.includes('@tensorflow'))
            ? 'assets/basic-pitch-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      injectManifest: {
        // app shell only: the model, the ONNX runtime WASM and Basic Pitch are cached on first use (see src/sw.ts)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/models/**', '**/assets/basic-pitch-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: 'ezpiano: audio to EZ-220 MIDI',
        short_name: 'ezpiano',
        description: 'Turn a piano recording into a learnable two-hand MIDI file and practise it with the keys lighting up on a Yamaha EZ-220.',
        theme_color: '#0c0d10',
        background_color: '#0c0d10',
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
    }),
  ],
})

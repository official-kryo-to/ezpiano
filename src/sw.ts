/// <reference lib="webworker" />
/**
 * Service worker.
 *  - Precaches the app shell (Workbox injectManifest).
 *  - Adds COOP/COEP headers to the page so it is cross-origin isolated. GitHub Pages can't set
 *    headers, and isolation is what lets onnxruntime-web use several CPU threads.
 *  - Caches the piano model, the ONNX runtime WASM and piano samples on first use (CacheFirst).
 */
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

self.skipWaiting()
clientsClaim()
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

function isolate(res: Response): Response {
  if (res.type === 'opaque' || res.status === 0) return res
  const headers = new Headers(res.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

const shell = createHandlerBoundToURL('index.html')
registerRoute(new NavigationRoute(async (opts) => isolate(await shell(opts))))

const sameOrigin = (url: URL) => url.origin === self.location.origin

// Android share target: keep the shared file for the page, then open the app
const SHARE_CACHE = 'ezpiano-share'
registerRoute(
  ({ url, request }) => request.method === 'POST' && sameOrigin(url) && url.pathname.endsWith('/share-target'),
  async ({ request }) => {
    try {
      const form = await request.formData()
      const file = form.getAll('audio').find((f): f is File => f instanceof File)
      if (file) {
        const cache = await caches.open(SHARE_CACHE)
        await cache.put('shared-file', new Response(file, { headers: { 'content-type': file.type || 'audio/mpeg', 'x-name': encodeURIComponent(file.name) } }))
      }
    } catch {
      /* fall through to the app */
    }
    return Response.redirect(`${self.registration.scope}?shared=1`, 303)
  },
  'POST',
)

// big files: the models and the ONNX runtime WebAssembly
registerRoute(
  ({ url }) => sameOrigin(url) && (/\/models\//.test(url.pathname) || url.pathname.endsWith('.wasm')),
  new CacheFirst({ cacheName: 'ezpiano-models', plugins: [new ExpirationPlugin({ maxEntries: 24 })] }),
)
// lazily loaded hashed chunks that are not precached
registerRoute(
  ({ url }) => sameOrigin(url) && /\/assets\/.+\.js$/.test(url.pathname),
  new CacheFirst({ cacheName: 'ezpiano-chunks', plugins: [new ExpirationPlugin({ maxEntries: 40 })] }),
)
// grand piano samples used for playback in the app
registerRoute(
  ({ url }) => url.hostname === 'smpldsnds.github.io',
  new CacheFirst({ cacheName: 'piano-samples', plugins: [new ExpirationPlugin({ maxEntries: 400 })] }),
)

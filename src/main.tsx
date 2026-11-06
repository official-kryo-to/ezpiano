import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App, { busy } from './App'
import './styles.css'

registerSW({
  immediate: true,
  // check for a new version every 30 minutes while the app is open (it then updates itself)
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => void reg.update().catch(() => {}), 30 * 60 * 1000)
  },
})

// The service worker makes the page cross-origin isolated (faster, multi-threaded conversion).
// It only applies to pages it serves, so reload once when it first takes control.
if ('serviceWorker' in navigator && !self.crossOriginIsolated) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try {
      if (busy.current || sessionStorage.getItem('ezpiano:isolated-reload')) return
      sessionStorage.setItem('ezpiano:isolated-reload', '1')
    } catch {
      return
    }
    location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

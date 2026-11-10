/** Keeps the screen on while converting or practising (phones would otherwise sleep mid-song). */
type Sentinel = { release(): Promise<void>; addEventListener(type: 'release', fn: () => void): void }
let lock: Sentinel | null = null
let wanted = false

export async function keepAwake(on: boolean) {
  wanted = on
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock
  if (!wl) return
  try {
    if (on && !lock) {
      lock = await wl.request('screen')
      lock.addEventListener('release', () => {
        lock = null
      })
    } else if (!on && lock) {
      const l = lock
      lock = null
      await l.release()
    }
  } catch {
    /* not allowed right now (tab hidden, battery saver): try again when visible */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void keepAwake(true)
  })
}

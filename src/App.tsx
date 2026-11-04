import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Loader2, Music, Settings as Cog } from 'lucide-react'
import { Practice } from './screens/Practice'
import { Songs } from './screens/Songs'
import { SettingsScreen } from './screens/SettingsScreen'
import { Learn } from './screens/learn/Learn'
import { audio } from './lib/audio'
import { loadBuiltin } from './lib/builtins'
import { connectMidi, installComputerKeyboard, input } from './lib/input'
import { downloadMidi, type SearchResult } from './lib/search'
import { cleanTitle, parseMidi, type Song } from './lib/song'
import { getSong, loadSettings, saveSong, storeSettings, updateSong, type Settings } from './lib/storage'

type Tab = 'songs' | 'learn' | 'settings'
interface InstallEvent extends Event {
  prompt: () => Promise<void>
}

export default function App() {
  const [tab, setTab] = useState<Tab>('songs')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [song, setSong] = useState<Song | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null)

  useEffect(() => installComputerKeyboard(), [])
  useEffect(() => {
    const unlock = () => audio.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    const onInstall = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', onInstall)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('beforeinstallprompt', onInstall)
    }
  }, [])

  useEffect(() => {
    storeSettings(settings)
    audio.setVolume(settings.volume)
    audio.setPreferSynth(settings.sound === 'synth')
  }, [settings])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(id)
  }, [toast])

  // Android back button closes the practice screen instead of leaving the app
  useEffect(() => {
    const onPop = () => setSong(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const open = useCallback((s: Song) => {
    void connectMidi()
    history.pushState({ practice: true }, '')
    setSong(s)
  }, [])

  const close = () => {
    input.releaseAll()
    if (history.state?.practice) history.back()
    else setSong(null)
    setLibraryVersion((v) => v + 1)
  }

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  const openResult = (r: SearchResult) =>
    withBusy(`Getting “${r.title}”…`, async () => {
      const id = `bitmidi:${r.id}`
      const cached = await getSong(id)
      const bytes = cached?.bytes ?? (await downloadMidi(r.downloadUrl))
      const s = parseMidi(bytes, id, r.title, 'bitmidi')
      await saveSong({ id, title: r.title, source: 'bitmidi', bytes })
      open(s)
    })

  const openSaved = (id: string) =>
    withBusy('Opening…', async () => {
      const saved = await getSong(id)
      if (!saved) throw new Error('Song not found')
      const s = parseMidi(saved.bytes, id, saved.title, saved.source)
      await saveSong({ id, title: saved.title, source: saved.source, bytes: saved.bytes })
      open(s)
    })

  const openImport = (file: File) =>
    withBusy(`Reading ${file.name}…`, async () => {
      const bytes = await file.arrayBuffer()
      const id = `import:${file.name}:${file.size}`
      const title = cleanTitle(file.name)
      const s = parseMidi(bytes, id, title, 'import')
      await saveSong({ id, title, source: 'import', bytes })
      open(s)
    })

  const openBuiltin = (id: string) => open(loadBuiltin(id))

  const onResult = (acc: number) => {
    if (!song || song.source === 'builtin') return
    void getSong(song.id).then((s) => {
      if (s && (s.best ?? -1) < acc) void updateSong(song.id, { best: acc })
    })
  }

  return (
    <div className="app">
      <div className="aurora" aria-hidden />
      {song ? (
        <Practice song={song} settings={settings} onSettings={setSettings} onClose={close} onResult={onResult} />
      ) : (
        <>
          <main className="main">
            <header className="brand">
              <div className="logo">
                <span className="logo-mark" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                ezpiano
              </div>
            </header>
            {tab === 'songs' && (
              <Songs
                onOpenResult={openResult}
                onOpenBuiltin={openBuiltin}
                onOpenSaved={openSaved}
                onImport={openImport}
                libraryVersion={libraryVersion}
              />
            )}
            {tab === 'learn' && <Learn settings={settings} />}
            {tab === 'settings' && (
              <SettingsScreen
                settings={settings}
                onChange={setSettings}
                canInstall={!!installEvt}
                onInstall={() => installEvt?.prompt().then(() => setInstallEvt(null))}
              />
            )}
          </main>
          <nav className="tabbar glass" aria-label="Main">
            <button className={tab === 'songs' ? 'on' : ''} onClick={() => setTab('songs')}>
              <Music size={22} />
              <span>Songs</span>
            </button>
            <button className={tab === 'learn' ? 'on' : ''} onClick={() => setTab('learn')}>
              <GraduationCap size={22} />
              <span>Learn notes</span>
            </button>
            <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
              <Cog size={22} />
              <span>Settings</span>
            </button>
          </nav>
        </>
      )}
      {busy && (
        <div className="busy">
          <div className="card glass">
            <Loader2 className="spin" size={26} />
            <p>{busy}</p>
          </div>
        </div>
      )}
      {toast && <div className="toast glass">{toast}</div>}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildResult, buildResultWithStages, prewarm, transcribeFile, type Progress } from './engine/client'
import { midiFileName } from './engine/midi'
import { packNotes, unpackNotes } from './engine/transcribe'
import type { BeatGrid, ConvertSettings, EngineKind, RawNote } from './engine/types'
import { MAX_STORED_AUDIO, getRecent, loadSettings, saveRecent, saveSettings, updateRecent } from './lib/storage'
import { midi } from './lib/midi'
import { keepAwake } from './lib/wakeLock'
import { installComputerKeys } from './practice/keys'
import { useMidiStatus } from './ui/KeyboardPanel'
import { Home } from './ui/Home'
import { ProgressCard } from './ui/ProgressCard'
import { ResultView } from './ui/ResultView'
import { SettingsCard } from './ui/SettingsCard'
import type { Result } from './engine/client'

interface Song {
  id: string
  title: string
  fileName: string
  duration: number
  engine: EngineKind
  raw: RawNote[]
  settings: ConvertSettings
  cache?: { clean: RawNote[]; grid: BeatGrid }
  audio?: Blob
  progress: Record<string, number>
}

type Screen =
  | { kind: 'home' }
  | { kind: 'settings'; file: File }
  | { kind: 'rearrange'; song: Song }
  | { kind: 'progress'; file: File; settings: ConvertSettings }
  | { kind: 'result'; song: Song; result: Result }

const titleOf = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled'

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/midi' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Used by main.tsx: don't auto-reload for cross-origin isolation in the middle of a conversion. */
export const busy = { current: false }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' })
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [preview, setPreview] = useState<{ notes: Float32Array[]; duration: number }>({ notes: [], duration: 0 })
  const midiStatus = useMidiStatus()

  useEffect(() => installComputerKeys(), [])
  // load the model and decode the file while the user is choosing settings
  useEffect(() => {
    if (screen.kind === 'settings') prewarm(screen.file, loadSettings().engine)
  }, [screen])
  useEffect(() => {
    void midi.reconnectIfAllowed()
  }, [])

  // files shared from another app (Android) or opened with the installed app (desktop)
  useEffect(() => {
    if (new URLSearchParams(location.search).has('shared') && 'caches' in window) {
      history.replaceState(null, '', location.pathname)
      void (async () => {
        const cache = await caches.open('ezpiano-share')
        const res = await cache.match('shared-file')
        if (!res) return
        await cache.delete('shared-file')
        const name = decodeURIComponent(res.headers.get('x-name') ?? 'Shared audio')
        const blob = await res.blob()
        setScreen({ kind: 'settings', file: new File([blob], name, { type: blob.type }) })
      })()
    }
    const lq = (window as unknown as { launchQueue?: { setConsumer(fn: (p: { files?: { getFile(): Promise<File> }[] }) => void): void } }).launchQueue
    lq?.setConsumer(async (params) => {
      const handle = params.files?.[0]
      if (handle) setScreen({ kind: 'settings', file: await handle.getFile() })
    })
  }, [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(id)
  }, [toast])

  const profile = midiStatus.profile
  const fit = useCallback(
    (s: ConvertSettings): ConvertSettings => ({ ...s, range: { low: profile.low, high: profile.high } }),
    [profile.low, profile.high],
  )

  const showResult = useCallback((song: Song, result: Result) => {
    setScreen({ kind: 'result', song: { ...song, cache: { clean: result.clean, grid: result.grid } }, result })
  }, [])

  // switching keyboards changes the playable range and the file channels: re-arrange instantly
  useEffect(() => {
    setScreen((sc) => {
      if (sc.kind !== 'result') return sc
      const settings = fit(sc.song.settings)
      if (JSON.stringify(settings.range) === JSON.stringify(sc.song.settings.range) && sc.result.midi.length) {
        return { ...sc, result: buildResult(sc.song.raw, settings, sc.song.title, sc.song.cache, profile.file) }
      }
      const song = { ...sc.song, settings }
      return { kind: 'result', song, result: buildResult(song.raw, settings, song.title, song.cache, profile.file) }
    })
  }, [profile.id, fit, profile.file])

  const convert = async (file: File, settings: ConvertSettings) => {
    saveSettings(settings)
    setError(null)
    setProgress(null)
    setScreen({ kind: 'progress', file, settings })
    const ac = new AbortController()
    abort.current = ac
    busy.current = true
    setPreview({ notes: [], duration: 0 })
    void keepAwake(true)
    try {
      const tr = await transcribeFile(file, settings.engine, setProgress, ac.signal, (notes, duration) =>
        setPreview((p) => ({ notes: [...p.notes, notes], duration })),
      )
      if (!tr.raw.length) throw new Error('No notes were found in this recording.')
      const title = titleOf(file.name)
      const result = await buildResultWithStages(tr.raw, fit(settings), title, setProgress, profile.file)
      const audio = file.size <= MAX_STORED_AUDIO ? file : undefined
      const song: Song = { id: `${Date.now()}`, title, fileName: file.name, duration: tr.duration, engine: settings.engine, raw: tr.raw, settings, audio, progress: {} }
      await saveRecent({
        id: song.id,
        title,
        fileName: file.name,
        createdAt: Date.now(),
        duration: tr.duration,
        engine: settings.engine,
        settings,
        notes: packNotes(tr.raw),
        bpm: result.arrangement.grid.bpm,
        noteCount: result.arrangement.notes.length,
        audio,
      }).catch(() => setToast('Could not save to Recent (storage is full or blocked).'))
      showResult(song, result)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      busy.current = false
      abort.current = null
      void keepAwake(false)
    }
  }

  const openRecent = async (id: string) => {
    const r = await getRecent(id)
    if (!r) return setToast('That song is no longer saved.')
    const song: Song = { id: r.id, title: r.title, fileName: r.fileName, duration: r.duration, engine: r.engine, raw: unpackNotes(r.notes), settings: fit(r.settings), audio: r.audio, progress: r.progress ?? {} }
    showResult(song, buildResult(song.raw, song.settings, song.title, undefined, profile.file))
  }

  const downloadRecent = async (id: string) => {
    const r = await getRecent(id)
    if (!r) return
    download(buildResult(unpackNotes(r.notes), fit(r.settings), r.title, undefined, profile.file).midi, midiFileName(`${r.title}.mid`, profile.short))
  }

  const engineLabel = (e: EngineKind) => (e === 'piano' ? 'Piano model' : 'Basic Pitch')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          ezpiano <small>recordings you can play</small>
        </div>
        {midiStatus.supported && (
          <button
            className="status-pill"
            aria-live="polite"
            onClick={() => !midiStatus.output && midi.connect()}
            title={midiStatus.output ? `${midiStatus.output.name} (${profile.name})` : 'Connect a keyboard over USB'}
          >
            <span className={`dot ${midiStatus.output ? 'ok' : ''}`} />
            {midiStatus.output ? profile.name : midiStatus.state === 'asking' ? 'Connecting…' : 'Connect keyboard'}
          </button>
        )}
      </header>

      {screen.kind === 'home' && <Home onFile={(file) => setScreen({ kind: 'settings', file })} onOpen={openRecent} onDownload={downloadRecent} />}

      {screen.kind === 'settings' && (
        <SettingsCard
          fileName={screen.file.name}
          initial={loadSettings()}
          instant={false}
          onBack={() => setScreen({ kind: 'home' })}
          onConvert={(s) => convert(screen.file, s)}
        />
      )}

      {screen.kind === 'rearrange' && (
        <SettingsCard
          fileName={screen.song.fileName}
          duration={screen.song.duration}
          initial={screen.song.settings}
          instant
          onBack={() => showResult(screen.song, buildResult(screen.song.raw, screen.song.settings, screen.song.title, screen.song.cache, profile.file))}
          onConvert={(s) => {
            const settings = fit({ ...s, engine: screen.song.engine })
            saveSettings(settings)
            const song = { ...screen.song, settings }
            const result = buildResult(song.raw, settings, song.title, song.cache, profile.file)
            void updateRecent(song.id, { settings, noteCount: result.arrangement.notes.length, bpm: result.arrangement.grid.bpm })
            showResult(song, result)
          }}
        />
      )}

      {screen.kind === 'progress' && (
        <ProgressCard
          fileName={screen.file.name}
          progress={progress}
          preview={preview}
          engine={screen.settings.engine}
          error={error}
          onCancel={() => {
            abort.current?.abort()
            setScreen(error ? { kind: 'settings', file: screen.file } : { kind: 'home' })
          }}
        />
      )}

      {screen.kind === 'result' && (
        <ResultView
          key={screen.song.id}
          title={screen.song.title}
          arrangement={screen.result.arrangement}
          engineLabel={engineLabel(screen.song.engine)}
          onBack={() => setScreen({ kind: 'home' })}
          onEdit={() => setScreen({ kind: 'rearrange', song: screen.song })}
          onDownload={() => download(screen.result.midi, midiFileName(`${screen.song.title}.mid`, profile.short))}
          onRename={(title) => {
            const song = { ...screen.song, title }
            void updateRecent(song.id, { title })
            showResult(song, buildResult(song.raw, song.settings, title, song.cache, profile.file))
          }}
          settings={screen.song.settings}
          audio={screen.song.audio}
          progress={screen.song.progress}
          onProgress={(key, value) => {
            const song = screen.song
            if ((song.progress[key] ?? 0) >= value) return
            song.progress = { ...song.progress, [key]: value }
            void updateRecent(song.id, { progress: song.progress })
            setScreen((sc) => (sc.kind === 'result' && sc.song.id === song.id ? { ...sc, song: { ...sc.song, progress: song.progress } } : sc))
          }}
          onArrange={(patch) => {
            const settings = fit({ ...screen.song.settings, ...patch })
            saveSettings(settings)
            const song = { ...screen.song, settings }
            const result = buildResult(song.raw, settings, song.title, song.cache, profile.file)
            void updateRecent(song.id, { settings, noteCount: result.arrangement.notes.length, bpm: result.arrangement.grid.bpm })
            showResult(song, result)
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildResult, buildResultWithStages, transcribeFile, type Progress } from './engine/client'
import { midiFileName } from './engine/midi'
import { packNotes, unpackNotes } from './engine/transcribe'
import type { BeatGrid, ConvertSettings, EngineKind, RawNote } from './engine/types'
import { getRecent, loadSettings, saveRecent, saveSettings, updateRecent } from './lib/storage'
import { midi } from './lib/midi'
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
  const midiStatus = useMidiStatus()

  useEffect(() => installComputerKeys(), [])
  useEffect(() => {
    void midi.reconnectIfAllowed()
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
    try {
      const tr = await transcribeFile(file, settings.engine, setProgress, ac.signal)
      if (!tr.raw.length) throw new Error('No notes were found in this recording.')
      const title = titleOf(file.name)
      const result = await buildResultWithStages(tr.raw, fit(settings), title, setProgress, profile.file)
      const song: Song = { id: `${Date.now()}`, title, fileName: file.name, duration: tr.duration, engine: settings.engine, raw: tr.raw, settings }
      await saveRecent({
        id: song.id,
        title,
        fileName: file.name,
        createdAt: Date.now(),
        duration: tr.duration,
        engine: settings.engine,
        settings,
        notes: packNotes(tr.raw),
        bpm: result.grid.bpm,
        noteCount: result.arrangement.notes.length,
      }).catch(() => setToast('Could not save to Recent (storage is full or blocked).'))
      showResult(song, result)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      busy.current = false
      abort.current = null
    }
  }

  const openRecent = async (id: string) => {
    const r = await getRecent(id)
    if (!r) return setToast('That song is no longer saved.')
    const song: Song = { id: r.id, title: r.title, fileName: r.fileName, duration: r.duration, engine: r.engine, raw: unpackNotes(r.notes), settings: fit(r.settings) }
    showResult(song, buildResult(song.raw, song.settings, song.title, undefined, profile.file))
  }

  const downloadRecent = async (id: string) => {
    const r = await getRecent(id)
    if (!r) return
    download(buildResult(unpackNotes(r.notes), fit(r.settings), r.title, undefined, profile.file).midi, midiFileName(r.fileName, profile.short))
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
            void updateRecent(song.id, { settings, noteCount: result.arrangement.notes.length, bpm: result.grid.bpm })
            showResult(song, result)
          }}
        />
      )}

      {screen.kind === 'progress' && (
        <ProgressCard
          fileName={screen.file.name}
          progress={progress}
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
          onDownload={() => download(screen.result.midi, midiFileName(screen.song.fileName, profile.short))}
          settings={screen.song.settings}
          onArrange={(patch) => {
            const settings = fit({ ...screen.song.settings, ...patch })
            saveSettings(settings)
            const song = { ...screen.song, settings }
            const result = buildResult(song.raw, settings, song.title, song.cache, profile.file)
            void updateRecent(song.id, { settings, noteCount: result.arrangement.notes.length, bpm: result.grid.bpm })
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

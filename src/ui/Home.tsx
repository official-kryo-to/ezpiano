import { useEffect, useRef, useState } from 'react'
import { ACCEPTED } from '../engine/decode'
import { deleteRecent, listRecent, type RecentMeta } from '../lib/storage'
import { fmtTime } from './controls'
import { IconDownload, IconTrash, IconUpload } from './icons'

interface Props {
  onFile: (f: File) => void
  onOpen: (id: string) => void
  onDownload: (id: string) => void
}

const AUDIO = /\.(mp3|wav|m4a|flac|aac|ogg)$/i

export function Home({ onFile, onOpen, onDownload }: Props) {
  const [over, setOver] = useState(false)
  const [recent, setRecent] = useState<RecentMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listRecent().then(setRecent, () => setRecent([]))
  }, [])

  const take = (f: File | undefined) => {
    if (!f) return
    if (!AUDIO.test(f.name) && !f.type.startsWith('audio/')) {
      setError('That does not look like an audio file. Use MP3, WAV, M4A or FLAC.')
      return
    }
    setError(null)
    onFile(f)
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>Turn a recording into something you can play.</h1>
        <p>Drop a piano cover. ezpiano writes a clean two-hand MIDI file and lights up the keys on your keyboard while you learn it.</p>
        <p className="supports">Key lights: Yamaha EZ-220, EZ-200, EZ-300, EZ-310 and Casio LK series. Any USB MIDI keyboard works for Wait for me.</p>
      </section>

      <section
        className={`drop glass ${over ? 'over' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take(e.dataTransfer.files?.[0])
        }}
        aria-label="Audio file drop zone"
      >
        <div className="drop-icon">
          <IconUpload size={22} />
        </div>
        <strong>Drop an audio file here</strong>
        <p>MP3, WAV, M4A or FLAC. Solo piano works best.</p>
        <button className="btn btn-primary btn-lg" onClick={() => input.current?.click()}>
          Choose file
        </button>
        <input ref={input} type="file" accept={ACCEPTED} hidden onChange={(e) => {
          take(e.target.files?.[0])
          e.target.value = ''
        }} />
        {error && <p className="notice err" role="alert">{error}</p>}
      </section>

      <section aria-labelledby="recent-h">
        <div className="section-title">
          <span id="recent-h">Recent</span>
          <span className="faint">saved on this device</span>
        </div>
        <div className="list glass">
          {recent.length === 0 && <p className="empty">Songs you convert show up here.</p>}
          {recent.map((r) => (
            <div className="row" key={r.id}>
              <button className="row-main" onClick={() => onOpen(r.id)}>
                <span className="row-title">{r.title}</span>
                <span className="row-meta num">
                  {fmtTime(r.duration)} · {Math.round(r.bpm)} BPM · {r.noteCount} notes · {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </button>
              <button className="icon-btn" aria-label={`Download ${r.title}`} title="Download .mid" onClick={() => onDownload(r.id)}>
                <IconDownload />
              </button>
              <button
                className="icon-btn"
                aria-label={`Remove ${r.title}`}
                title="Remove"
                onClick={async () => {
                  await deleteRecent(r.id)
                  setRecent(await listRecent())
                }}
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

import { useEffect, useRef, useState } from 'react'
import { ACCEPTED } from '../engine/decode'
import { deleteRecent, listRecent, type RecentMeta } from '../lib/storage'
import { fmtTime } from './controls'
import { IconDownload, IconTrash, IconUpload } from './icons'
import { Recorder, canCaptureTab, canRecordMic, type RecordSource } from './Recorder'

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
  const [recording, setRecording] = useState<RecordSource | null>(null)
  const [query, setQuery] = useState('')
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

      {recording ? (
        <Recorder source={recording} onDone={onFile} onCancel={() => setRecording(null)} />
      ) : (
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
      )}

      {!recording && (canCaptureTab() || canRecordMic()) && (
        <section aria-labelledby="more-h">
          <div className="section-title">
            <span id="more-h">No file?</span>
          </div>
          <div className="ways">
            {canCaptureTab() && (
              <div className="way glass">
                <strong>Find a song and let ezpiano listen</strong>
                <p className="muted">Search opens in a new tab. Start the video there, come back, press Listen and pick that tab.</p>
                <form
                  className="find"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!query.trim()) return
                    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${query.trim()} piano`)}`, '_blank', 'noopener')
                  }}
                >
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Song name" aria-label="Song to search for" />
                  <button className="btn btn-secondary" type="submit" disabled={!query.trim()}>
                    Search
                  </button>
                </form>
                <button className="btn btn-primary" onClick={() => setRecording('tab')}>
                  Listen to a tab
                </button>
              </div>
            )}
            {canRecordMic() && (
              <div className="way glass">
                <strong>Record with the microphone</strong>
                <p className="muted">Play the song on a speaker nearby, or play it yourself.</p>
                <button className="btn btn-secondary" onClick={() => setRecording('mic')}>
                  Start recording
                </button>
              </div>
            )}
          </div>
          <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>
            Recording takes as long as the song. Only record music you're allowed to use; everything stays on this device.
          </p>
        </section>
      )}

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

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileUp, Heart, Music, Search, Sparkles, Trash2, X } from 'lucide-react'
import { builtinList } from '../lib/builtins'
import { formatPlays, QUICK_PICKS, searchMidi, type SearchResult } from '../lib/search'
import { deleteSong, listSongs, updateSong, type SavedSongMeta } from '../lib/storage'

interface Props {
  onOpenResult: (r: SearchResult) => void
  onOpenBuiltin: (id: string) => void
  onOpenSaved: (id: string) => void
  onImport: (file: File) => void
  libraryVersion: number
}

export function Songs({ onOpenResult, onOpenBuiltin, onOpenSaved, onImport, libraryVersion }: Props) {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [library, setLibrary] = useState<SavedSongMeta[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    listSongs().then(setLibrary).catch(() => setLibrary([]))
  }, [libraryVersion])

  const run = async (q: string) => {
    const term = q.trim()
    if (!term) return
    setQuery(term)
    setSubmitted(term)
    setLoading(true)
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const r = await searchMidi(term, ac.signal)
      setResults(r)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(navigator.onLine ? 'Search is having a moment. Try again?' : 'You’re offline. Your saved songs still work.')
      setResults(null)
    } finally {
      if (abortRef.current === ac) setLoading(false)
    }
  }

  const clear = () => {
    abortRef.current?.abort()
    setQuery('')
    setSubmitted('')
    setResults(null)
    setError(null)
    setLoading(false)
  }

  const refresh = () => listSongs().then(setLibrary)

  return (
    <div
      className="screen songs"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const f = e.dataTransfer.files?.[0]
        if (f) onImport(f)
      }}
    >
      <section className="hero">
        <h1>
          What do you want <span className="grad">to play?</span>
        </h1>
        <p className="sub">Type a song. We find it, slow it down, and show you exactly which keys to press.</p>
        <form
          className="search glass"
          onSubmit={(e) => {
            e.preventDefault()
            void run(query)
          }}
        >
          <Search size={20} className="search-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Song or artist, e.g. River Flows in You"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search songs"
          />
          {query && (
            <button type="button" className="icon-btn" onClick={clear} aria-label="Clear">
              <X size={18} />
            </button>
          )}
          <button type="submit" className="btn search-go" disabled={!query.trim()}>
            Find
          </button>
        </form>
      </section>

      {submitted ? (
        <section className="results">
          <div className="section-head">
            <h2>Results for “{submitted}”</h2>
            {results && !loading && <span className="muted">{results.length} found</span>}
          </div>
          {loading && (
            <div className="list">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="row-card glass skeleton" />
              ))}
            </div>
          )}
          {error && (
            <div className="notice glass">
              <p>{error}</p>
              <button className="btn" onClick={() => run(submitted)}>Retry</button>
            </div>
          )}
          {results && !loading && (
            <div className="list">
              {results.map((r, i) => (
                <button key={r.id} className="row-card glass" onClick={() => onOpenResult(r)}>
                  <div className={`art ${i === 0 ? 'top' : ''}`}>
                    <Music size={18} />
                  </div>
                  <div className="row-main">
                    <strong>{r.title}</strong>
                    <span className="muted">
                      {formatPlays(r.plays)} plays
                      {/piano/i.test(r.name) && <em className="badge">Piano</em>}
                      {i === 0 && <em className="badge accent">Best match</em>}
                    </span>
                  </div>
                  <span className="go">Learn</span>
                </button>
              ))}
            </div>
          )}
          {!loading && (
            <div className="notice glass not-found">
              <div>
                <strong>Can’t find it, or the version is weird?</strong>
                <p className="muted">
                  Newer hits often aren’t in the free MIDI library yet. Grab a .mid file from one of these, then import it here.
                </p>
              </div>
              <div className="row wrap">
                <a className="btn ghost small" href={`https://musescore.com/sheetmusic?text=${encodeURIComponent(submitted)}`} target="_blank" rel="noreferrer">
                  MuseScore <ExternalLink size={14} />
                </a>
                <a className="btn ghost small" href={`https://www.google.com/search?q=${encodeURIComponent(`${submitted} piano midi`)}`} target="_blank" rel="noreferrer">
                  Search the web <ExternalLink size={14} />
                </a>
                <button className="btn small" onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} /> Import .mid
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          <section>
            <div className="section-head">
              <h2>
                <Sparkles size={16} /> Quick picks
              </h2>
            </div>
            <div className="chips">
              {QUICK_PICKS.map((p) => (
                <button key={p.label} className="chip glass" onClick={() => run(p.q)}>
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          {library.length > 0 && (
            <section>
              <div className="section-head">
                <h2>Your songs</h2>
                <span className="muted">saved on this device</span>
              </div>
              <div className="list">
                {library.map((s) => (
                  <div key={s.id} className="row-card glass">
                    <button className="row-hit" onClick={() => onOpenSaved(s.id)}>
                      <div className="art">
                        <Music size={18} />
                      </div>
                      <div className="row-main">
                        <strong>{s.title}</strong>
                        <span className="muted">
                          {s.best != null ? `Best ${s.best}%` : 'Not played yet'} · {new Date(s.lastPlayed).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                    <button
                      className={`icon-btn ${s.favorite ? 'fav' : ''}`}
                      aria-label="Favorite"
                      onClick={async () => {
                        await updateSong(s.id, { favorite: !s.favorite })
                        void refresh()
                      }}
                    >
                      <Heart size={18} fill={s.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Delete"
                      onClick={async () => {
                        if (!confirm(`Remove “${s.title}” from your songs?`)) return
                        await deleteSong(s.id)
                        void refresh()
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="section-head">
              <h2>Start here</h2>
              <span className="muted">works offline</span>
            </div>
            <div className="grid">
              {builtinList.map((b) => (
                <button key={b.id} className="tile glass" onClick={() => onOpenBuiltin(b.id)}>
                  <span className={`level l-${b.level.toLowerCase()}`}>{b.level}</span>
                  <strong>{b.title}</strong>
                  <span className="muted">{b.artist}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <button className="import glass" onClick={() => fileRef.current?.click()}>
              <FileUp size={22} />
              <div>
                <strong>Import a MIDI file</strong>
                <span className="muted">Got a .mid from somewhere? Drop it here or tap to pick it.</span>
              </div>
            </button>
          </section>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".mid,.midi,audio/midi,audio/x-midi"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImport(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Eye, Gauge, Hand, Music2, Pause, Play, Repeat, RotateCcw, SlidersHorizontal, Trophy, Type, X,
} from 'lucide-react'
import { FallingNotes } from '../components/FallingNotes'
import { LetterSheet } from '../components/LetterSheet'
import { Piano, type KeyMark } from '../components/Piano'
import { audio } from '../lib/audio'
import { input, onMidiState } from '../lib/input'
import { fitRange } from '../lib/notes'
import { MODE_LABEL, PracticeEngine, type Mode } from '../lib/practice'
import { buildLearnNotes, PART_LABEL, type Part, type Song } from '../lib/song'
import type { Settings } from '../lib/storage'

interface Props {
  song: Song
  settings: Settings
  onSettings: (s: Settings) => void
  onClose: () => void
  onResult?: (accuracy: number) => void
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const SPEEDS = [0.5, 0.75, 1]

export function Practice({ song, settings, onSettings, onClose, onResult }: Props) {
  const engine = useMemo(() => new PracticeEngine(), [])
  const hasTwoHands = song.notes.some((n) => song.learnTracks.includes(n.track) && n.midi < 60)
  const [part, setPart] = useState<Part>(song.source === 'builtin' ? (hasTwoHands ? 'right' : 'both') : 'easy')
  const [mode, setMode] = useState<Mode>('wait')
  const [speed, setSpeed] = useState(song.source === 'builtin' ? 1 : 0.75)
  const [learnTracks, setLearnTracks] = useState<number[]>(song.learnTracks)
  const [backing, setBacking] = useState(song.source !== 'builtin')
  const [view, setView] = useState<'fall' | 'letters'>('fall')
  const [sheet, setSheet] = useState(false)
  const [, force] = useState(0)
  const [loopA, setLoopA] = useState<number | null>(null)
  const [marks, setMarks] = useState<Map<number, KeyMark>>(new Map())
  const [midiDevice, setMidiDevice] = useState<string | null>(null)
  const [audioStatus, setAudioStatus] = useState(audio.status)
  const progressRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const scrubbing = useRef(false)
  const reported = useRef(false)

  const learn = useMemo(() => buildLearnNotes(song, learnTracks, part), [song, learnTracks, part])
  const range = useMemo<[number, number]>(() => {
    if (!learn.length) return [48, 72]
    let lo = 127
    let hi = 0
    for (const n of learn) {
      lo = Math.min(lo, n.midi)
      hi = Math.max(hi, n.midi)
    }
    return fitRange(lo, hi, 2)
  }, [learn])

  // what plays through the speakers by itself
  const sound = useMemo(() => {
    const learnSet = new Set(learnTracks)
    const backingNotes = backing
      ? song.notes.filter((n) => !learnSet.has(n.track) && !song.tracks.find((t) => t.index === n.track)?.isDrums)
      : []
    // in "both"/"easy" parts, the non-chosen hand of the learn tracks is accompaniment too
    const learnIds = new Set(learn.map((n) => `${n.track}:${n.time.toFixed(3)}:${n.midi}`))
    const otherHand =
      part === 'right' || part === 'left'
        ? song.notes.filter((n) => learnSet.has(n.track) && !learnIds.has(`${n.track}:${n.time.toFixed(3)}:${n.midi}`))
        : []
    const guide = mode === 'watch' ? learn : []
    return [...backingNotes, ...otherHand, ...guide].sort((a, b) => a.time - b.time)
  }, [song, learnTracks, backing, learn, mode, part])

  useEffect(() => {
    engine.configure({ learn, sound, mode, duration: song.duration })
    reported.current = false
  }, [engine, learn, sound, song.duration]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engine.setMode(mode)
  }, [engine, mode])
  useEffect(() => engine.setSpeed(speed), [engine, speed])
  useEffect(() => engine.onChange(() => force((x) => x + 1)), [engine])
  useEffect(() => input.subscribe((ev) => engine.handleInput(ev)), [engine])
  useEffect(() => onMidiState((s) => setMidiDevice(s.devices[0] ?? null)), [])
  useEffect(() => audio.onStatus(setAudioStatus), [])
  useEffect(
    () => () => {
      engine.pause()
      input.releaseAll()
    },
    [engine],
  )

  // main clock loop: advance engine, update scrubber + key highlights
  useEffect(() => {
    let raf = 0
    let lastSig = ''
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const t = engine.tick()
      if (progressRef.current && !scrubbing.current) progressRef.current.value = String(t)
      if (timeRef.current) timeRef.current.textContent = `${fmt(t)} / ${fmt(song.duration)}`
      const m = new Map<number, KeyMark>()
      const now = performance.now()
      for (const n of engine.learn) {
        if (n.time > t + 0.01) break
        if (n.time + n.duration > t) m.set(n.midi, n.hand)
      }
      for (const n of engine.targets) m.set(n.midi, 'target')
      for (const [midi, f] of engine.flashes) {
        if (f.until < now) engine.flashes.delete(midi)
        else m.set(midi, f.kind)
      }
      let sig = ''
      for (const [k, v] of m) sig += `${k}${v},`
      if (sig !== lastSig) {
        lastSig = sig
        setMarks(m)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [engine, song.duration])

  useEffect(() => {
    if (engine.finished && mode !== 'watch' && !reported.current) {
      reported.current = true
      onResult?.(engine.accuracy)
    }
  })

  // space = play/pause, arrows = seek
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        engine.toggle()
      } else if (e.key === 'ArrowLeft') engine.seek(engine.t - 3)
      else if (e.key === 'ArrowRight') engine.seek(engine.t + 3)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine])

  const toggleLoop = () => {
    if (engine.loop) {
      engine.loop = null
      setLoopA(null)
    } else if (loopA == null) {
      setLoopA(engine.t)
    } else {
      const a = Math.min(loopA, engine.t)
      const b = Math.max(loopA, engine.t)
      if (b - a > 0.5) {
        engine.loop = { a, b }
        engine.seek(a)
      }
      setLoopA(null)
    }
    force((x) => x + 1)
  }

  const seek = useCallback((t: number) => engine.seek(t), [engine])
  const isPhonePortrait = typeof window !== 'undefined' && window.matchMedia('(max-width: 600px) and (orientation: portrait)').matches
  const finePointer = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const octaves = (range[1] - range[0] + 1) / 12
  const score = engine.score
  const loopLabel = engine.loop ? 'Looping' : loopA != null ? 'Set end' : 'Loop'

  return (
    <div className="practice">
      <header className="p-top glass">
        <button className="icon-btn" onClick={onClose} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className="p-title">
          <strong>{song.title}</strong>
          <span>
            {PART_LABEL[part]} · {MODE_LABEL[mode]}
            {midiDevice && <em className="dot-ok"> · {midiDevice}</em>}
          </span>
        </div>
        <div className="seg small" role="tablist">
          <button className={view === 'fall' ? 'on' : ''} onClick={() => setView('fall')} aria-label="Falling notes">
            <Music2 size={16} />
          </button>
          <button className={view === 'letters' ? 'on' : ''} onClick={() => setView('letters')} aria-label="Letter notes">
            <Type size={16} />
          </button>
        </div>
        <button className="icon-btn" onClick={() => setSheet(true)} aria-label="Practice options">
          <SlidersHorizontal size={20} />
        </button>
      </header>

      <div className="stage">
        {view === 'fall' ? (
          <FallingNotes
            engine={engine}
            lo={range[0]}
            hi={range[1]}
            zoom={settings.zoom}
            labels={settings.noteLabels}
            naming={settings.naming}
            bars={song.bars}
          />
        ) : (
          <LetterSheet engine={engine} notes={learn} bars={song.bars} naming={settings.naming} onSeek={seek} />
        )}

        {mode !== 'watch' && (score.hits > 0 || score.wrong > 0 || score.misses > 0) && (
          <div className="score-chip glass">
            <span>{engine.accuracy}%</span>
            {score.streak >= 3 && <em>🔥 {score.streak}</em>}
          </div>
        )}
        {audioStatus === 'loading' && <div className="loading-chip glass">Loading grand piano…</div>}
        {engine.waiting && view === 'fall' && <div className="wait-hint">Play the glowing {engine.targets.length > 1 ? 'keys' : 'key'}</div>}

        {!learn.length && (
          <div className="overlay">
            <div className="card glass">
              <Hand size={28} />
              <h3>No notes for this part</h3>
              <p>Try a different hand or pick another track in options.</p>
              <button className="btn" onClick={() => setSheet(true)}>Open options</button>
            </div>
          </div>
        )}

        {!engine.playing && !engine.finished && engine.t === 0 && learn.length > 0 && (
          <button className="overlay start" onClick={() => engine.play()}>
            <div className="card glass">
              <div className="big-play"><Play size={30} fill="currentColor" /></div>
              <h3>{mode === 'wait' ? 'The song waits for you' : mode === 'play' ? 'Play along in time' : 'Watch & listen first'}</h3>
              <p>
                {mode === 'wait'
                  ? 'Notes stop at the line until you press the glowing key. No rush.'
                  : mode === 'play'
                    ? 'Hit each note as it reaches the line. Green = nailed it.'
                    : 'Hear how it goes and watch the keys light up.'}
              </p>
              {isPhonePortrait && octaves > 2 && <p className="tip">Tip: turn your phone sideways for bigger keys.</p>}
            </div>
          </button>
        )}

        {engine.finished && (
          <div className="overlay">
            <div className="card glass result">
              <Trophy size={30} />
              {mode === 'watch' ? (
                <>
                  <h3>Now you try</h3>
                  <p>Switch to “Wait for me” and play it yourself.</p>
                  <div className="row">
                    <button className="btn" onClick={() => { setMode('wait'); engine.seek(0); engine.finished = false; force((x) => x + 1) }}>Let me play</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="acc">{engine.accuracy}%</div>
                  <p>
                    {score.hits} notes · {score.wrong + score.misses} slips · best streak {score.bestStreak}
                  </p>
                  <div className="row">
                    <button className="btn ghost" onClick={() => { setSpeed(Math.max(0.25, speed - 0.25)); engine.play() }}>Slower</button>
                    <button className="btn" onClick={() => engine.play()}>Again</button>
                    {mode === 'wait' && engine.accuracy >= 80 && (
                      <button className="btn ghost" onClick={() => { setMode('play'); engine.seek(0); engine.finished = false; force((x) => x + 1) }}>Play in time</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="scrub">
        <input
          ref={progressRef}
          type="range"
          min={0}
          max={song.duration}
          step={0.01}
          defaultValue={0}
          onPointerDown={() => (scrubbing.current = true)}
          onPointerUp={() => (scrubbing.current = false)}
          onChange={(e) => engine.seek(parseFloat(e.target.value))}
          aria-label="Song position"
        />
        <span ref={timeRef} className="time">0:00</span>
      </div>

      <Piano
        lo={range[0]}
        hi={range[1]}
        marks={marks}
        labels={settings.keyLabels ? 'all' : 'c'}
        naming={settings.naming}
        showComputerKeys={finePointer}
        height="clamp(110px, 24vh, 210px)"
      />

      <footer className="p-controls glass">
        <button className="ctl" onClick={() => { engine.resetScore(); engine.seek(engine.loop?.a ?? 0); force((x) => x + 1) }}>
          <RotateCcw size={18} />
          <span>Restart</span>
        </button>
        <button className="ctl" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)}>
          <Gauge size={18} />
          <span>{Math.round(speed * 100)}%</span>
        </button>
        <button className="play-btn" onClick={() => engine.toggle()} aria-label={engine.playing ? 'Pause' : 'Play'}>
          {engine.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>
        <button className={`ctl ${engine.loop || loopA != null ? 'active' : ''}`} onClick={toggleLoop}>
          <Repeat size={18} />
          <span>{loopLabel}</span>
        </button>
        <button className="ctl" onClick={() => setMode(mode === 'watch' ? 'wait' : mode === 'wait' ? 'play' : 'watch')}>
          <Eye size={18} />
          <span>{mode === 'watch' ? 'Watch' : mode === 'wait' ? 'Wait' : 'Play'}</span>
        </button>
      </footer>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h3>Practice options</h3>
              <button className="icon-btn" onClick={() => setSheet(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <label className="field-label">What do you want to play?</label>
            <div className="seg wide grid2">
              {(Object.keys(PART_LABEL) as Part[]).map((p) => (
                <button key={p} className={part === p ? 'on' : ''} onClick={() => setPart(p)}>
                  {PART_LABEL[p]}
                </button>
              ))}
            </div>
            <p className="field-help">
              {part === 'easy'
                ? 'One note at a time: just the tune, moved to the middle of the keyboard.'
                : part === 'both'
                  ? 'Everything in the chosen tracks. Turn your phone sideways for room.'
                  : 'One hand at a time. The other hand plays along for you.'}
            </p>

            <label className="field-label">How do you want to practice?</label>
            <div className="seg wide">
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>

            <label className="field-label">
              Speed <b>{Math.round(speed * 100)}%</b>
            </label>
            <input type="range" min={0.25} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />

            <label className="field-label">
              Note fall speed <b>{settings.zoom}px/s</b>
            </label>
            <input
              type="range"
              min={80}
              max={320}
              step={10}
              value={settings.zoom}
              onChange={(e) => onSettings({ ...settings, zoom: parseInt(e.target.value, 10) })}
            />

            <div className="toggles">
              <label className="toggle">
                <input type="checkbox" checked={settings.noteLabels} onChange={(e) => onSettings({ ...settings, noteLabels: e.target.checked })} />
                <span>Letters on falling notes</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={backing} onChange={(e) => setBacking(e.target.checked)} />
                <span>Play the other instruments</span>
              </label>
            </div>

            {song.tracks.length > 1 && (
              <>
                <label className="field-label">Tracks to learn</label>
                <div className="tracks">
                  {song.tracks.map((t) => {
                    const on = learnTracks.includes(t.index)
                    return (
                      <button
                        key={t.index}
                        className={`track ${on ? 'on' : ''}`}
                        disabled={t.isDrums}
                        onClick={() =>
                          setLearnTracks(on ? learnTracks.filter((x) => x !== t.index) : [...learnTracks, t.index].sort((a, b) => a - b))
                        }
                      >
                        <span className="track-name">{t.name}</span>
                        <span className="track-meta">
                          {t.isDrums ? 'drums' : t.instrument} · {t.noteCount} notes
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button className="btn ghost small" onClick={() => setLearnTracks(song.learnTracks)}>
                  Reset to suggested
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

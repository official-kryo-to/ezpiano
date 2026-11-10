import { useEffect, useMemo, useRef, useState } from 'react'
import { keyName } from '../engine/arrange'
import type { ArrangeSettings, Arrangement, Difficulty, OutputMode } from '../engine/types'
import { audio } from '../lib/audio'
import { midi } from '../lib/midi'
import { keepAwake } from '../lib/wakeLock'
import { keys } from '../practice/keys'
import { Player, type HandSel, type Mode } from '../practice/player'
import { Segmented, Toggle, fmtTime } from './controls'
import { FallingNotes } from './FallingNotes'
import { IconBack, IconDownload, IconPause, IconPlay, IconRestart, IconSliders } from './icons'
import { Keyboard, type KeyMarks } from './Keyboard'
import { noteName } from './keyLayout'
import { KeyboardPanel, useMidiStatus } from './KeyboardPanel'

interface Props {
  title: string
  arrangement: Arrangement
  engineLabel: string
  onBack: () => void
  onDownload: () => void
  onEdit: () => void
  settings: ArrangeSettings
  /** instant re-arrange from the practice screen */
  onArrange: (patch: Partial<ArrangeSettings>) => void
  onRename: (title: string) => void
  /** the original recording, if it was kept */
  audio?: Blob
  /** best Wait-for-me accuracy per part */
  progress: Record<string, number>
  onProgress: (key: string, accuracy: number) => void
}

const DONE = 0.9

export function ResultView({ title, arrangement, engineLabel, onBack, onDownload, onEdit, settings, onArrange, onRename, audio: recording, progress, onProgress }: Props) {
  const [editing, setEditing] = useState(false)
  const [hasRecording, setHasRecording] = useState(false)
  const [autoNext, setAutoNext] = useState(true)
  const [passMsg, setPassMsg] = useState<string | null>(null)
  const player = useMemo(() => new Player(), [])
  const [, force] = useState(0)
  const [marks, setMarks] = useState<KeyMarks>({ hand: new Map(), target: new Map(), flash: new Map() })
  const [volume, setVolume] = useState(midi.prefs.volume)
  const [loopA, setLoopA] = useState<number | null>(null)
  const status = useMidiStatus()
  const { low, high } = status.profile
  const scrubRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const scrubbing = useRef(false)

  const bars = useMemo(() => {
    const b = arrangement.grid.beats
    return b.filter((_, i) => i % arrangement.beatsPerBar === 0).map((x) => x - b[0])
  }, [arrangement])

  useEffect(() => {
    const b = arrangement.grid.beats
    const at = player.t
    player.load(arrangement.notes, arrangement.duration, b.map((x) => x - b[0]), arrangement.beatsPerBar)
    player.originalOffset = b[0]
    if (at > 0) player.seek(Math.min(at, arrangement.duration)) // keep the place when re-arranging
  }, [player, arrangement])

  // the original recording, played in sync on request
  useEffect(() => {
    if (!recording) return
    const url = URL.createObjectURL(recording)
    const el = new Audio(url)
    el.preload = 'auto'
    el.volume = midi.prefs.volume
    el.addEventListener('loadedmetadata', () => setHasRecording(true))
    el.addEventListener('error', () => {
      setHasRecording(false)
      player.setOriginal(null)
    })
    player.setOriginal(el, player.originalOffset)
    return () => {
      player.setOriginal(null)
      el.src = ''
      URL.revokeObjectURL(url)
      setHasRecording(false)
    }
  }, [player, recording])

  // parts of the song (a few bars each) for step-by-step practice
  const sections = useMemo(() => {
    const end = arrangement.duration + 0.3
    const inSong = bars.filter((b) => b < arrangement.duration - 0.2)
    const per = inSong.length <= 8 ? 2 : inSong.length <= 96 ? 4 : 8
    const out: { a: number; b: number }[] = []
    for (let i = 0; i < inSong.length; i += per) out.push({ a: inSong[i], b: Math.min(bars[i + per] ?? end, end) })
    const tail = inSong.length % per
    if (out.length > 1 && tail !== 0 && tail < per / 2) {
      const last = out.pop()!
      out[out.length - 1].b = last.b
    }
    return out
  }, [bars, arrangement.duration])
  const partKey = (i: number | 'all') => `${settings.difficulty}:${settings.output}:${player.hands}:${i}`
  const samePart = (x: { a: number; b: number } | null, y: { a: number; b: number }) => !!x && Math.abs(x.a - y.a) < 0.02 && Math.abs(x.b - y.b) < 0.02

  useEffect(() => {
    player.onPass = (p) => {
      const i = sections.findIndex((s) => samePart(p, s))
      const pct = Math.round(p.accuracy * 100)
      if (i < 0) {
        if (p.a < 0.05 && p.b >= arrangement.duration - 0.05) onProgress(partKey('all'), p.accuracy)
        return
      }
      onProgress(partKey(i), p.accuracy)
      const next = sections[i + 1]
      if (autoNext && p.accuracy >= DONE) {
        if (next) {
          player.setLoop(next)
          setPassMsg(`Part ${i + 1}: ${pct}%. On to part ${i + 2}.`)
        } else {
          player.setLoop(null)
          setPassMsg(`Part ${i + 1}: ${pct}%. That was the last part.`)
        }
      } else setPassMsg(`Part ${i + 1}: ${pct}%${p.accuracy >= DONE ? '' : `. ${Math.round(DONE * 100)}% moves you on`}`)
    }
    return () => {
      player.onPass = null
    }
  })
  useEffect(() => {
    if (!passMsg) return
    const id = setTimeout(() => setPassMsg(null), 2600)
    return () => clearTimeout(id)
  }, [passMsg])
  useEffect(() => {
    void keepAwake(player.playing)
    return () => void keepAwake(false)
  }, [player, player.playing])
  useEffect(() => player.onChange(() => force((x) => x + 1)), [player])
  useEffect(() => keys.subscribe((e) => e.type === 'on' && player.handleKey(e.note)), [player])
  // re-route sound when the keyboard connects or its settings change
  useEffect(() => {
    player.reroute()
    player.seek(player.t)
  }, [player, status.output?.id, status.profile.id])
  useEffect(() => {
    audio.setVolume(volume)
    if (player.original) player.original.volume = volume
  }, [volume, player, hasRecording])
  useEffect(() => () => player.dispose(), [player])

  // clock + key highlights
  useEffect(() => {
    let raf = 0
    let sig = ''
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const t = player.tick()
      if (scrubRef.current && !scrubbing.current) scrubRef.current.value = String(t)
      if (timeRef.current) timeRef.current.textContent = `${fmtTime(t)} / ${fmtTime(arrangement.duration)}`
      const hand = new Map<number, 'R' | 'L'>()
      const practiced = new Set(player.practiced)
      for (const n of player.all) {
        if (n.start > t + 0.005) break
        if (n.end > t && practiced.has(n)) hand.set(n.pitch, n.hand)
      }
      const target = new Map(player.targets.map((n) => [n.pitch, n.hand] as const))
      const flash = new Map<number, 'good' | 'bad'>()
      const now = performance.now()
      for (const [k, f] of player.flashes) {
        if (f.until < now) player.flashes.delete(k)
        else flash.set(k, f.kind)
      }
      let s = ''
      for (const [k, v] of hand) s += `${k}${v}`
      s += '|'
      for (const [k, v] of target) s += `${k}${v},`
      s += '|'
      for (const [k, v] of flash) s += `${k}${v},`
      if (s !== sig) {
        sig = s
        setMarks({ hand, target, flash })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [player, arrangement.duration])

  // space: play/pause, arrows: seek
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        player.toggle()
      } else if (e.key === 'ArrowLeft') player.seek(player.t - 5)
      else if (e.key === 'ArrowRight') player.seek(player.t + 5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  const rh = arrangement.notes.filter((n) => n.hand === 'R').length
  const lh = arrangement.notes.length - rh
  const loop = player.loop
  const keyInfo = `${keyName(arrangement.key)}${arrangement.transpose ? ` (${arrangement.transpose > 0 ? '+' : ''}${arrangement.transpose})` : ''}`

  const loopButton = () => {
    if (loop) {
      player.setLoop(null)
      setLoopA(null)
    } else if (loopA == null) setLoopA(player.t)
    else {
      player.setLoop({ a: Math.min(loopA, player.t), b: Math.max(loopA, player.t) })
      setLoopA(null)
    }
  }

  return (
    <div className="result">
      <header className="result-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to start">
          <IconBack />
        </button>
        <div className="result-title">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const v = (new FormData(e.currentTarget).get('t') as string).trim()
                if (v) onRename(v)
                setEditing(false)
              }}
            >
              <input className="title-input" name="t" defaultValue={title} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Song name" />
            </form>
          ) : (
            <h1>
              <button className="title-btn" onClick={() => setEditing(true)} title="Rename">
                {title}
              </button>
            </h1>
          )}
          <div className="meta num">
            <span>{Math.round(arrangement.grid.bpm)} BPM</span>
            <span>{keyInfo}</span>
            <span>{fmtTime(arrangement.duration)}</span>
            <span>
              {rh} right · {lh} left
            </span>
            <span>{engineLabel}</span>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={onEdit}>
          <IconSliders /> Arrangement
        </button>
        <button className="btn btn-primary" onClick={onDownload}>
          <IconDownload /> Download .mid
        </button>
      </header>

      <div className="stagebox">
        <div className="fall">
          <FallingNotes player={player} bars={bars} low={low} high={high} />
          {player.mode === 'wait' && !player.finished && player.targets.length > 0 && (player.waiting || !player.playing) && (
            <div className="fall-overlay" aria-live="polite">
              {player.playing ? 'Play ' : 'Press '}
              <b>
                {[...player.targets]
                  .sort((a, b) => a.pitch - b.pitch)
                  .map((n) => noteName(n.pitch))
                  .join(' + ')}
              </b>
              {player.playing ? '' : ' to start'}
            </div>
          )}
          {player.finished && (
            <div className="fall-overlay">
              {player.mode === 'wait' && player.stats.hits + player.stats.wrong > 0
                ? `Done: ${Math.round((player.stats.hits / (player.stats.hits + player.stats.wrong)) * 100)}% right. Press play to go again.`
                : 'Done. Press play to go again.'}
            </div>
          )}
          {passMsg && (
            <div className="fall-overlay pass" role="status">
              {passMsg}
            </div>
          )}
        </div>
        <Keyboard marks={marks} low={low} high={high} />
        {sections.length > 1 && (
          <div className="parts" role="group" aria-label="Parts of the song">
            <button className={`part ${loop ? '' : 'on'}`} onClick={() => player.setLoop(null)} aria-pressed={!loop}>
              All
            </button>
            {sections.map((sec, i) => {
              const best = progress[partKey(i)]
              const on = samePart(loop, sec)
              return (
                <button
                  key={i}
                  className={`part ${on ? 'on' : ''} ${best != null ? (best >= DONE ? 'done' : 'tried') : ''}`}
                  aria-pressed={on}
                  title={`Part ${i + 1}: ${fmtTime(sec.a)} to ${fmtTime(sec.b)}${best != null ? `, best ${Math.round(best * 100)}%` : ''}`}
                  onClick={() => {
                    if (on) player.setLoop(null)
                    else {
                      player.setLoop(sec)
                      player.seek(sec.a)
                    }
                  }}
                >
                  {i + 1}
                  {best != null && best < DONE && <small className="num">{Math.round(best * 100)}</small>}
                </button>
              )
            })}
          </div>
        )}
        <div className="transport">
          <button className="play" onClick={() => player.toggle()} aria-label={player.playing ? 'Pause' : 'Play'}>
            {player.playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="icon-btn" onClick={() => player.seek(loop?.a ?? 0)} aria-label="Back to start of song or loop">
            <IconRestart />
          </button>
          <div className="scrub">
            <div className="scrub-track">
              {loop && (
                <div
                  className="loop-band"
                  style={{ left: `${(loop.a / arrangement.duration) * 100}%`, width: `${((loop.b - loop.a) / arrangement.duration) * 100}%` }}
                />
              )}
              <input
                ref={scrubRef}
                type="range"
                min={0}
                max={arrangement.duration}
                step={0.01}
                defaultValue={0}
                aria-label="Position"
                onPointerDown={() => (scrubbing.current = true)}
                onPointerUp={() => (scrubbing.current = false)}
                onChange={(e) => player.seek(parseFloat(e.target.value))}
              />
            </div>
            <span ref={timeRef} className="time num">
              0:00
            </span>
          </div>
        </div>
      </div>

      <aside className="side" aria-label="Practice settings">
        <section className="panel glass" aria-labelledby="ar-h">
          <h3 id="ar-h">Arrangement</h3>
          <div className="ctl">
            <span className="ctl-label">Difficulty</span>
            <Segmented<Difficulty>
              label="Difficulty"
              full
              value={settings.difficulty}
              onChange={(d) => onArrange({ difficulty: d })}
              options={[
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'original', label: 'Original' },
              ]}
            />
          </div>
          <div className="ctl">
            <span className="ctl-label">Output</span>
            <Segmented<OutputMode>
              label="Output"
              full
              value={settings.output}
              onChange={(o) => onArrange({ output: o })}
              options={[
                { value: 'melody', label: 'Melody' },
                { value: 'chords', label: 'Chords' },
                { value: 'full', label: 'Full' },
              ]}
            />
          </div>
          <details className="fix">
            <summary>Rhythm looks off?</summary>
            <div className="ctl">
              <span className="ctl-label">Count the beat</span>
              <Segmented<'0.5' | '1' | '2'>
                label="Count the beat"
                full
                value={String(settings.tempoScale ?? 1) as '0.5' | '1' | '2'}
                onChange={(v) => onArrange({ tempoScale: Number(v) as 0.5 | 1 | 2, barShift: 0 })}
                options={[
                  { value: '0.5', label: 'Half speed' },
                  { value: '1', label: 'As found' },
                  { value: '2', label: 'Double' },
                ]}
              />
            </div>
            <div className="ctl">
              <span className="ctl-label">Beats in a bar</span>
              <Segmented<'4' | '3'>
                label="Beats in a bar"
                full
                value={String(settings.beatsPerBar ?? 4) as '4' | '3'}
                onChange={(v) => onArrange({ beatsPerBar: Number(v) as 3 | 4, barShift: 0 })}
                options={[
                  { value: '4', label: '4' },
                  { value: '3', label: '3 (waltz)' },
                ]}
              />
            </div>
            <div className="ctl">
              <span className="ctl-label">
                <span>Bar line</span>
                <span className="num faint">{(settings.barShift ?? 0) === 0 ? 'as found' : `${settings.barShift} beat${settings.barShift === 1 ? '' : 's'} later`}</span>
              </span>
              <div className="ctl-row">
                <button
                  className="btn btn-secondary"
                  onClick={() => onArrange({ barShift: ((settings.barShift ?? 0) + 1) % (settings.beatsPerBar ?? 4) })}
                >
                  Move one beat later
                </button>
              </div>
            </div>
            <p className="kb-note">
              {Math.round(arrangement.grid.bpm)} BPM{arrangement.feel === 'triplet' ? ', triplet feel' : ''}. Turn on the metronome to check: the high click should land on beat 1.
            </p>
          </details>
          {(settings.output === 'full' || settings.difficulty === 'original') && (
            <p className="kb-note" style={{ marginTop: 8 }}>
              Too much going on? Easy with Chords gives one tune note at a time and one chord per bar.
            </p>
          )}
        </section>

        <section className="panel glass" aria-labelledby="pr-h">
          <h3 id="pr-h">Practice</h3>
          <div className="ctl">
            <span className="ctl-label">Mode</span>
            <Segmented<Mode>
              label="Mode"
              full
              value={player.mode}
              onChange={(m) => player.setMode(m)}
              options={[
                { value: 'watch', label: 'Watch' },
                { value: 'wait', label: 'Wait for me' },
              ]}
            />
          </div>
          <div className="ctl">
            <span className="ctl-label">Hands</span>
            <Segmented<HandSel>
              label="Hands"
              full
              value={player.hands}
              onChange={(h) => player.setHands(h)}
              options={[
                { value: 'R', label: 'Right' },
                { value: 'L', label: 'Left' },
                { value: 'both', label: 'Both' },
              ]}
            />
            <div className="legend">
              <span>
                <i className="swatch rh" />
                Right hand
              </span>
              <span>
                <i className="swatch lh" />
                Left hand
              </span>
            </div>
          </div>
          {hasRecording && (
            <div className="ctl">
              <span className="ctl-label">Sound</span>
              <Segmented<'piano' | 'recording'>
                label="Sound"
                full
                value={player.useOriginal ? 'recording' : 'piano'}
                onChange={(v) => player.setUseOriginal(v === 'recording')}
                options={[
                  { value: 'piano', label: 'Piano' },
                  { value: 'recording', label: 'Recording' },
                ]}
              />
              {player.useOriginal && (player.mode === 'wait' || arrangement.transpose !== 0) && (
                <p className="kb-note">
                  {player.mode === 'wait'
                    ? 'The recording plays in Watch mode. Wait for me uses the piano, because it stops and starts.'
                    : 'The recording is in the original key, so it will not match the transposed notes.'}
                </p>
              )}
            </div>
          )}
          {player.mode === 'wait' && sections.length > 1 && (
            <div className="ctl">
              <Toggle label="Move to the next part at 90%" checked={autoNext} onChange={setAutoNext} />
            </div>
          )}
          <div className="ctl">
            <label className="ctl-label" htmlFor="speed">
              <span>Speed</span>
              <span className="num">{Math.round(player.speed * 100)}%</span>
            </label>
            <input id="speed" type="range" min={0.25} max={1.5} step={0.05} value={player.speed} onChange={(e) => player.setSpeed(parseFloat(e.target.value))} />
          </div>
          <div className="ctl">
            <span className="ctl-label">
              <span>A/B loop</span>
              <span className="num faint">{loop ? `${fmtTime(loop.a)} to ${fmtTime(loop.b)}` : loopA != null ? `A at ${fmtTime(loopA)}` : 'Off'}</span>
            </span>
            <div className="ctl-row">
              <button className="btn btn-secondary" onClick={loopButton}>
                {loop ? 'Clear loop' : loopA == null ? 'Set A here' : 'Set B here'}
              </button>
              {loopA != null && !loop && (
                <button className="btn btn-ghost" onClick={() => setLoopA(null)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div className="ctl">
            <Toggle label="Metronome" checked={player.metronome} onChange={(v) => player.setMetronome(v)} />
          </div>
          <div className="ctl">
            <label className="ctl-label" htmlFor="vol">
              <span>App volume</span>
              <span className="num">{Math.round(volume * 100)}%</span>
            </label>
            <input
              id="vol"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setVolume(v)
                midi.setPrefs({ volume: v })
              }}
            />
          </div>
          {player.mode === 'wait' && (
            <p className="score num" aria-live="polite">
              <span>{player.stats.hits} right</span>
              <span>{player.stats.wrong} wrong</span>
            </p>
          )}
          <p className="kb-note" style={{ marginTop: 12 }}>
            {player.mode === 'wait'
              ? 'The song stops at each highlighted chord and goes on when you play it. Playing a little early is fine. '
              : ''}
            {player.hands !== 'both' ? 'The other hand plays from this device. ' : ''}
            {status.output ? '' : 'Space plays and pauses. Without a keyboard, play on screen or with the A W S E D F G keys (Z / X change octave).'}
          </p>
        </section>

        <KeyboardPanel
          onChange={() => {
            player.reroute()
            if (player.playing) player.seek(player.t)
          }}
        />
      </aside>
    </div>
  )
}

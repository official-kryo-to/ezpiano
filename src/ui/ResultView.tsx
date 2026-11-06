import { useEffect, useMemo, useRef, useState } from 'react'
import { keyName } from '../engine/arrange'
import type { ArrangeSettings, Arrangement, Difficulty, OutputMode } from '../engine/types'
import { audio } from '../lib/audio'
import { midi } from '../lib/midi'
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
}

export function ResultView({ title, arrangement, engineLabel, onBack, onDownload, onEdit, settings, onArrange }: Props) {
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
    return b.filter((_, i) => i % 4 === 0).map((x) => x - b[0])
  }, [arrangement])

  useEffect(() => {
    const b = arrangement.grid.beats
    player.load(arrangement.notes, arrangement.duration, b.map((x) => x - b[0]))
  }, [player, arrangement])
  useEffect(() => player.onChange(() => force((x) => x + 1)), [player])
  useEffect(() => keys.subscribe((e) => e.type === 'on' && player.handleKey(e.note)), [player])
  // re-route sound when the keyboard connects or its settings change
  useEffect(() => {
    player.reroute()
    player.seek(player.t)
  }, [player, status.output?.id, status.profile.id])
  useEffect(() => audio.setVolume(volume), [volume])
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
          <h1>{title}</h1>
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
        </div>
        <Keyboard marks={marks} low={low} high={high} />
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

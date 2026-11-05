import { useEffect, useMemo, useRef, useState } from 'react'
import { keyName } from '../engine/arrange'
import type { Arrangement } from '../engine/types'
import { keys } from '../practice/keys'
import { Player, type HandSel, type Mode } from '../practice/player'
import { Segmented, fmtTime } from './controls'
import { FallingNotes } from './FallingNotes'
import { IconBack, IconDownload, IconPause, IconPlay, IconRestart, IconSliders } from './icons'
import { Keyboard, type KeyMarks } from './Keyboard'
import { KeyboardPanel, useMidiStatus } from './KeyboardPanel'

interface Props {
  title: string
  arrangement: Arrangement
  engineLabel: string
  onBack: () => void
  onDownload: () => void
  onEdit: () => void
}

export function ResultView({ title, arrangement, engineLabel, onBack, onDownload, onEdit }: Props) {
  const player = useMemo(() => new Player(), [])
  const [, force] = useState(0)
  const [marks, setMarks] = useState<KeyMarks>({ hand: new Map(), target: new Set() })
  const [loopA, setLoopA] = useState<number | null>(null)
  const status = useMidiStatus()
  const scrubRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const scrubbing = useRef(false)

  const bars = useMemo(() => {
    const b = arrangement.grid.beats
    return b.filter((_, i) => i % 4 === 0).map((x) => x - b[0])
  }, [arrangement])

  useEffect(() => {
    player.load(arrangement.notes, arrangement.duration)
  }, [player, arrangement])
  useEffect(() => player.onChange(() => force((x) => x + 1)), [player])
  useEffect(() => keys.subscribe((e) => e.type === 'on' && player.handleKey(e.note)), [player])
  // re-route sound when the keyboard connects or its settings change
  useEffect(() => {
    player.reroute()
    if (player.playing) player.seek(player.t)
  }, [player, status.output?.id])
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
      const target = new Set(player.targets.map((n) => n.pitch))
      let s = ''
      for (const [k, v] of hand) s += `${k}${v}`
      s += '|'
      for (const k of target) s += `${k},`
      if (s !== sig) {
        sig = s
        setMarks({ hand, target })
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
          <FallingNotes player={player} bars={bars} />
          {player.waiting && <div className="fall-overlay">Play the {player.targets.length > 1 ? 'highlighted keys' : 'highlighted key'}</div>}
          {player.finished && <div className="fall-overlay">Done. Press play to go again.</div>}
        </div>
        <Keyboard marks={marks} />
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
          {player.mode === 'wait' && (
            <p className="score num" aria-live="polite">
              <span>{player.stats.hits} right</span>
              <span>{player.stats.wrong} wrong</span>
            </p>
          )}
          <p className="kb-note" style={{ marginTop: 12 }}>
            {player.hands !== 'both' ? 'The other hand plays from this device. ' : ''}
            {status.output ? 'Keys light up on the keyboard (channel 1).' : 'Space plays and pauses. You can also play on screen or with A W S E D keys.'}
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

import { useEffect, useMemo, useRef, useState } from 'react'
import { noteName, octaveOf, type NoteNaming } from '../lib/notes'
import { groupChords, type LearnNote } from '../lib/song'
import type { PracticeEngine } from '../lib/practice'

interface Props {
  engine: PracticeEngine
  notes: LearnNote[]
  bars: number[]
  naming: NoteNaming
  onSeek: (t: number) => void
}

/**
 * The "TikTok tutorial" view: the song as letters, bar by bar.
 * Current chord is highlighted and tapping a letter jumps there.
 */
export function LetterSheet({ engine, notes, bars, naming, onSeek }: Props) {
  const chords = useMemo(() => groupChords(notes), [notes])
  const rows = useMemo(() => {
    const out: { bar: number; chords: { idx: number; notes: LearnNote[] }[] }[] = []
    let b = 0
    chords.forEach((c, idx) => {
      const t = c[0].time
      while (b + 1 < bars.length && bars[b + 1] <= t + 0.02) b++
      const last = out[out.length - 1]
      if (last && last.bar === b) last.chords.push({ idx, notes: c })
      else out.push({ bar: b, chords: [{ idx, notes: c }] })
    })
    return out
  }, [chords, bars])

  const [current, setCurrent] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let last = -1
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const t = engine.t
      // the chord being played (or about to be)
      let lo = 0
      let hi = chords.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (chords[mid][0].time < t - 0.05) lo = mid + 1
        else hi = mid
      }
      const idx = engine.mode === 'wait' ? engine.chordIdx : lo
      if (idx !== last) {
        last = idx
        setCurrent(idx)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [engine, chords])

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-chord="${current}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [current])

  if (!chords.length) return <div className="empty">No notes in this part.</div>

  return (
    <div className="letters" ref={scroller}>
      <p className="letters-hint">
        Numbers are the octave: <b>4</b> is the middle of the keyboard (middle C = C4). Tap any letter to jump there.
      </p>
      <div className="letter-bars">
        {rows.map((row) => (
          <div className="letter-bar" key={row.bar}>
            <span className="bar-num">{row.bar + 1}</span>
            <div className="bar-chords">
              {row.chords.map(({ idx, notes: c }) => (
                <button
                  key={idx}
                  data-chord={idx}
                  className={`chord ${idx === current ? 'now' : idx < current ? 'done' : ''} ${c[0].hand === 'L' ? 'lh' : ''}`}
                  onClick={() => onSeek(Math.max(0, c[0].time - 0.4))}
                >
                  {[...c]
                    .sort((a, b) => b.midi - a.midi)
                    .map((n) => (
                      <span key={n.id} className={`ln ${n.hand === 'L' ? 'lh' : ''}`}>
                        {noteName(n.midi, naming)}
                        <sub>{octaveOf(n.midi)}</sub>
                      </span>
                    ))}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

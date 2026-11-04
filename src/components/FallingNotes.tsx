import { useEffect, useRef } from 'react'
import { layoutKeys, noteName, pitchClass, type KeyRect, type NoteNaming } from '../lib/notes'
import { NOTE_HIT, NOTE_MISS, lowerBound, type PracticeEngine } from '../lib/practice'

interface Props {
  engine: PracticeEngine
  lo: number
  hi: number
  zoom: number // px per second (at 1x speed)
  labels: boolean
  naming: NoteNaming
  bars: number[]
}

const COLORS = {
  R: ['#5eead4', '#22d3ee', '#0ea5e9'],
  L: ['#c4b5fd', '#a78bfa', '#7c3aed'],
}

/** Synthesia-style falling notes, drawn on a canvas synced to the PracticeEngine clock. */
export function FallingNotes({ engine, lo, hi, zoom, labels, naming, bars }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const props = useRef({ lo, hi, zoom, labels, naming, bars })
  props.current = { lo, hi, zoom, labels, naming, bars }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let w = 0
    let h = 0
    let dpr = 1
    let keyMap = new Map<number, KeyRect>()
    let keyKey = ''

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      keyKey = ''
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const roundRect = (x: number, y: number, rw: number, rh: number, r: number) => {
      const rr = Math.min(r, rw / 2, rh / 2)
      ctx.beginPath()
      ctx.moveTo(x + rr, y)
      ctx.arcTo(x + rw, y, x + rw, y + rh, rr)
      ctx.arcTo(x + rw, y + rh, x, y + rh, rr)
      ctx.arcTo(x, y + rh, x, y, rr)
      ctx.arcTo(x, y, x + rw, y, rr)
      ctx.closePath()
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const { lo, hi, zoom, labels, naming, bars } = props.current
      const t = engine.t
      const k = `${lo}-${hi}-${w}`
      if (k !== keyKey) {
        keyKey = k
        keyMap = new Map(layoutKeys(lo, hi, w).keys.map((r) => [r.midi, r]))
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // lane guides: a line at every C and a soft band behind black-key lanes
      for (const r of keyMap.values()) {
        if (r.black) {
          ctx.fillStyle = 'rgba(255,255,255,0.025)'
          ctx.fillRect(r.x, 0, r.w, h)
        } else if (pitchClass(r.midi) === 0 || pitchClass(r.midi) === 5) {
          ctx.fillStyle = pitchClass(r.midi) === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)'
          ctx.fillRect(Math.round(r.x), 0, 1, h)
        }
      }

      const pps = zoom / Math.max(0.35, engine.speed) // slower speed = notes further apart in time but same visual pace
      const span = h / pps

      // bar lines
      const bi = firstAfter(bars, t - 0.1)
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      for (let i = bi; i < bars.length && bars[i] < t + span; i++) {
        const y = h - (bars[i] - t) * pps
        ctx.fillRect(0, Math.round(y), w, 1)
      }

      const notes = engine.learn
      const targets = new Set(engine.targets.map((n) => n.id))
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160)
      let i = lowerBound(notes, t - 6)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (; i < notes.length; i++) {
        const n = notes[i]
        if (n.time > t + span) break
        const end = n.time + n.duration
        if (end < t - 0.05) continue
        const r = keyMap.get(n.midi)
        if (!r) continue
        const yBottom = h - (n.time - t) * pps
        const yTop = h - (end - t) * pps
        const pad = r.black ? 1 : 2
        const x = r.x + pad
        const nw = r.w - pad * 2
        const nh = Math.max(6, yBottom - yTop - 1)
        const st = engine.state[n.id]
        const pal = COLORS[n.hand]
        let fill: string | CanvasGradient
        if (st === NOTE_HIT) fill = '#34d399'
        else if (st === NOTE_MISS) fill = 'rgba(248,113,113,0.55)'
        else {
          const g = ctx.createLinearGradient(0, yTop, 0, yTop + nh)
          g.addColorStop(0, r.black ? pal[2] : pal[0])
          g.addColorStop(1, r.black ? pal[2] : pal[1])
          fill = g
        }
        const isTarget = targets.has(n.id)
        if (isTarget) {
          ctx.shadowColor = n.hand === 'L' ? '#a78bfa' : '#22d3ee'
          ctx.shadowBlur = 12 + pulse * 14
        }
        roundRect(x, yBottom - nh, nw, nh, Math.min(7, nw / 3))
        ctx.fillStyle = fill
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1
        ctx.stroke()
        if (labels && nh >= 16 && nw >= 11) {
          ctx.fillStyle = 'rgba(4,10,20,0.85)'
          const fs = Math.max(9, Math.min(14, nw * 0.55))
          ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`
          ctx.fillText(noteName(n.midi, naming).replace('#', '♯'), x + nw / 2, yBottom - 3)
        }
      }

      // hit line glow
      const g = ctx.createLinearGradient(0, h - 24, 0, h)
      g.addColorStop(0, 'rgba(34,211,238,0)')
      g.addColorStop(1, engine.waiting ? `rgba(34,211,238,${0.18 + pulse * 0.2})` : 'rgba(124,92,255,0.18)')
      ctx.fillStyle = g
      ctx.fillRect(0, h - 24, w, 24)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [engine])

  return <canvas ref={canvasRef} className="fall-canvas" />
}

function firstAfter(arr: number[], t: number) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

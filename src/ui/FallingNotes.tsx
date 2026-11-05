import { useEffect, useRef } from 'react'
import { lowerBound, type Player } from '../practice/player'
import { layout, letter, type KeyRect } from './keyLayout'

const COLOR = {
  R: { fill: '#8fb3ff', black: '#6c93e6' },
  L: { fill: '#e6b47a', black: '#c99658' },
}

/** Notes falling onto the keyboard, synced to the player clock. */
export function FallingNotes({
  player,
  bars,
  low,
  high,
  labels = true,
  pxPerSecond = 140,
}: {
  player: Player
  bars: number[]
  low: number
  high: number
  labels?: boolean
  pxPerSecond?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const props = useRef({ bars, pxPerSecond, low, high, labels })
  props.current = { bars, pxPerSecond, low, high, labels }

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let w = 0
    let h = 0
    let dpr = 1
    let keyOf = new Map<number, KeyRect>()
    let layoutKey = ''
    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      layoutKey = ''
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const rr = (x: number, y: number, rw: number, rh: number, r: number) => {
      const q = Math.min(r, rw / 2, rh / 2)
      ctx.beginPath()
      ctx.roundRect(x, y, rw, rh, q)
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const { bars, pxPerSecond, low, high, labels } = props.current
      const lk = `${w}:${low}:${high}`
      if (lk !== layoutKey) {
        layoutKey = lk
        keyOf = new Map(layout(w, low, high).map((k) => [k.midi, k]))
      }
      const t = player.t
      const pps = pxPerSecond / Math.max(0.35, player.speed)
      const span = h / pps
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // lanes: faint line at every C and soft bands behind black keys
      for (const k of keyOf.values()) {
        if (k.black) {
          ctx.fillStyle = 'rgba(255,255,255,0.018)'
          ctx.fillRect(k.x, 0, k.w, h)
        } else if (k.midi % 12 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.06)'
          ctx.fillRect(Math.round(k.x), 0, 1, h)
        }
      }
      // bar lines
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      for (const b of bars) {
        if (b < t - 0.1) continue
        if (b > t + span) break
        ctx.fillRect(0, Math.round(h - (b - t) * pps), w, 1)
      }
      // loop region
      if (player.loop) {
        const y1 = h - (player.loop.b - t) * pps
        const y0 = h - (player.loop.a - t) * pps
        ctx.fillStyle = 'rgba(143,179,255,0.05)'
        ctx.fillRect(0, Math.max(0, y1), w, Math.min(h, y0) - Math.max(0, y1))
      }

      const practiced = new Set(player.practiced)
      const targets = new Set(player.targets)
      for (let i = lowerBound(player.all, t - 12); i < player.all.length; i++) {
        const n = player.all[i]
        if (n.start > t + span) break
        if (n.end < t - 0.05) continue
        const k = keyOf.get(n.pitch)
        if (!k) continue
        const y0 = h - (n.start - t) * pps
        const y1 = h - (n.end - t) * pps
        const pad = k.black ? 1 : 1.5
        const x = k.x + pad
        const nw = Math.max(2, k.w - pad * 2)
        const nh = Math.max(4, y0 - y1 - 1)
        const c = COLOR[n.hand]
        ctx.globalAlpha = practiced.has(n) ? 1 : 0.28
        rr(x, y0 - nh, nw, nh, Math.min(4, nw / 3))
        ctx.fillStyle = k.black ? c.black : c.fill
        ctx.fill()
        if (targets.has(n)) {
          ctx.lineWidth = 2
          ctx.strokeStyle = '#ffffff'
          ctx.stroke()
        }
        if (labels && nw >= 12 && nh >= 18 && practiced.has(n)) {
          ctx.fillStyle = 'rgba(12,13,16,0.82)'
          ctx.font = `600 ${Math.min(12, Math.max(9, nw * 0.5))}px 'Inter Variable', system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(letter(n.pitch), x + nw / 2, y0 - 3)
        }
      }
      ctx.globalAlpha = 1
      // the "now" line
      ctx.fillStyle = player.waiting ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)'
      ctx.fillRect(0, h - 1, w, 1)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [player])

  return <canvas ref={ref} aria-hidden />
}

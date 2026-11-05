import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { keys } from '../practice/keys'
import { layout, letter, noteName } from './keyLayout'

export interface KeyMarks {
  hand: Map<number, 'R' | 'L'>
  target: Map<number, 'R' | 'L'>
  flash: Map<number, 'good' | 'bad'>
}

/** The keyboard's keys. Shows what is sounding, what to press next, and takes mouse or touch. */
export function Keyboard({ marks, low, high }: { marks: KeyMarks; low: number; high: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const pointers = useRef(new Map<number, number>())

  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => keys.subscribe(() => setPressed(new Set(keys.held))), [])

  const rects = useMemo(() => layout(width, low, high), [width, low, high])
  const keyAt = (cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect()
    const x = cx - r.left
    const y = cy - r.top
    if (x < 0 || x > r.width || y < 0 || y > r.height) return null
    if (y < r.height * 0.62) {
      const b = rects.find((k) => k.black && x >= k.x && x <= k.x + k.w)
      if (b) return b.midi
    }
    return rects.find((k) => !k.black && x >= k.x && x < k.x + k.w)?.midi ?? null
  }

  return (
    <div
      ref={ref}
      className="kb"
      role="img"
      aria-label={`${high - low + 1}-key keyboard`}
      onPointerDown={(e) => {
        const m = keyAt(e.clientX, e.clientY)
        if (m == null) return
        e.currentTarget.setPointerCapture(e.pointerId)
        pointers.current.set(e.pointerId, m)
        keys.press(m, 'screen')
      }}
      onPointerMove={(e) => {
        const cur = pointers.current.get(e.pointerId)
        if (cur == null) return
        const m = keyAt(e.clientX, e.clientY)
        if (m === cur) return
        keys.release(cur, 'screen')
        if (m == null) pointers.current.delete(e.pointerId)
        else {
          pointers.current.set(e.pointerId, m)
          keys.press(m, 'screen')
        }
      }}
      onPointerUp={(e) => {
        const cur = pointers.current.get(e.pointerId)
        if (cur != null) keys.release(cur, 'screen')
        pointers.current.delete(e.pointerId)
      }}
      onPointerCancel={(e) => {
        const cur = pointers.current.get(e.pointerId)
        if (cur != null) keys.release(cur, 'screen')
        pointers.current.delete(e.pointerId)
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {width > 0 &&
        rects.map((k) => {
          const target = marks.target.get(k.midi)
          const hand = marks.hand.get(k.midi) ?? target
          const flash = marks.flash.get(k.midi)
          const cls = ['key', k.black ? 'b' : 'w', hand ?? '', target ? 'target' : '', flash ?? '', pressed.has(k.midi) ? 'pressed' : '']
            .filter(Boolean)
            .join(' ')
          return (
            <div key={k.midi} className={cls} style={{ left: k.x, width: k.w }}>
              {target && k.w > 9 ? (
                <span className="key-name">{letter(k.midi)}</span>
              ) : (
                !k.black && k.midi % 12 === 0 && k.w > 9 && <span className="key-c">{noteName(k.midi)}</span>
              )}
            </div>
          )
        })}
    </div>
  )
}

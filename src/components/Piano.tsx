import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { layoutKeys, noteName, pitchClass, type NoteNaming } from '../lib/notes'
import { computerKeyFor, input, onKeyboardOctave } from '../lib/input'

export type KeyMark = 'R' | 'L' | 'target' | 'good' | 'bad' | 'hint'

interface Props {
  lo: number
  hi: number
  /** keys highlighted by the app: song notes, targets, feedback */
  marks?: Map<number, KeyMark>
  labels?: 'all' | 'c' | 'none'
  naming?: NoteNaming
  showComputerKeys?: boolean
  height?: number | string
  onWidth?: (w: number) => void
  className?: string
}

export function usePressed() {
  const [pressed, setPressed] = useState<Set<number>>(() => new Set(input.held))
  useEffect(
    () =>
      input.subscribe(() => {
        setPressed(new Set(input.held))
      }),
    [],
  )
  return pressed
}

export function Piano({ lo, hi, marks, labels = 'all', naming = 'letters', showComputerKeys = false, height = 160, onWidth, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const pressed = usePressed()
  const pointers = useRef(new Map<number, number>())
  const [, setOct] = useState(0)

  useEffect(() => onKeyboardOctave(setOct), [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setWidth(w)
      onWidth?.(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [onWidth])

  const { keys } = useMemo(() => layoutKeys(lo, hi, width), [lo, hi, width])
  const whites = keys.filter((k) => !k.black)
  const blacks = keys.filter((k) => k.black)

  const keyAt = (clientX: number, clientY: number): number | null => {
    const el = ref.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = clientX - r.left
    const y = clientY - r.top
    if (y < 0 || y > r.height || x < 0 || x > r.width) return null
    if (y < r.height * 0.62) {
      const b = blacks.find((k) => x >= k.x && x <= k.x + k.w)
      if (b) return b.midi
    }
    const w = whites.find((k) => x >= k.x && x < k.x + k.w)
    return w ? w.midi : null
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    const m = keyAt(e.clientX, e.clientY)
    if (m == null) return
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, m)
    // velocity from vertical position: pressing nearer the front is louder
    input.press(m, 0.75, 'touch')
  }
  const move = (e: React.PointerEvent) => {
    const cur = pointers.current.get(e.pointerId)
    if (cur == null) return
    const m = keyAt(e.clientX, e.clientY)
    if (m === cur) return
    input.release(cur)
    if (m == null) {
      pointers.current.delete(e.pointerId)
      return
    }
    pointers.current.set(e.pointerId, m)
    input.press(m, 0.7, 'touch')
  }
  const up = (e: React.PointerEvent) => {
    const cur = pointers.current.get(e.pointerId)
    if (cur != null) input.release(cur)
    pointers.current.delete(e.pointerId)
  }

  const showLabel = (m: number, black: boolean) =>
    labels === 'all' ? !black : labels === 'c' ? pitchClass(m) === 0 : false

  return (
    <div
      ref={ref}
      className={`piano ${className}`}
      style={{ height }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      role="group"
      aria-label="Piano keyboard"
    >
      {width > 0 &&
        keys.map((k) => {
          const mark = marks?.get(k.midi)
          const isDown = pressed.has(k.midi)
          const kbd = showComputerKeys ? computerKeyFor(k.midi) : null
          return (
            <div
              key={k.midi}
              className={`key ${k.black ? 'black' : 'white'} ${mark ? `mark-${mark}` : ''} ${isDown ? 'down' : ''}`}
              style={{ left: k.x, width: k.w }}
              data-midi={k.midi}
            >
              {kbd && <span className="kbd-hint">{kbd}</span>}
              {showLabel(k.midi, k.black) && (
                <span className="key-label">
                  {noteName(k.midi, naming)}
                  {pitchClass(k.midi) === 0 && <sub>{Math.floor(k.midi / 12) - 1}</sub>}
                </span>
              )}
            </div>
          )
        })}
    </div>
  )
}

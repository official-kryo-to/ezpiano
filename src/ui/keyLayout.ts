const BLACK = new Set([1, 3, 6, 8, 10])
export const isBlack = (m: number) => BLACK.has(m % 12)

export interface KeyRect {
  midi: number
  x: number
  w: number
  black: boolean
}

/** Keys from `low` to `high` (inclusive) laid out across `width` px. */
export function layout(width: number, low: number, high: number): KeyRect[] {
  // never start or end on a black key
  const lo = isBlack(low) ? low - 1 : low
  const hi = isBlack(high) ? high + 1 : high
  let whites = 0
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++
  const ww = width / whites
  const bw = ww * 0.6
  const lean: Record<number, number> = { 1: -0.08, 3: 0.08, 6: -0.1, 8: 0, 10: 0.1 }
  const out: KeyRect[] = []
  let wi = 0
  for (let m = lo; m <= hi; m++) {
    if (isBlack(m)) {
      const cx = wi * ww + lean[m % 12] * bw
      out.push({ midi: m, x: cx - bw / 2, w: bw, black: true })
    } else {
      out.push({ midi: m, x: wi * ww, w: ww, black: false })
      wi++
    }
  }
  return out
}

export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`
export const letter = (m: number) => NAMES[m % 12]

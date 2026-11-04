export type NoteNaming = 'letters' | 'solfege'

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SOLFEGE = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
const BLACK = new Set([1, 3, 6, 8, 10])
const LETTER_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export const isBlack = (midi: number) => BLACK.has(((midi % 12) + 12) % 12)
export const pitchClass = (midi: number) => ((midi % 12) + 12) % 12
export const octaveOf = (midi: number) => Math.floor(midi / 12) - 1

export function noteName(midi: number, naming: NoteNaming = 'letters', withOctave = false): string {
  const pc = pitchClass(midi)
  const base = naming === 'solfege' ? SOLFEGE[pc] : SHARP_NAMES[pc]
  return withOctave ? `${base}${octaveOf(midi)}` : base
}

/** "C4", "F#5", "Bb3" -> midi number */
export function parseNote(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim())
  if (!m) throw new Error(`Bad note: ${name}`)
  let pc = LETTER_TO_PC[m[1].toUpperCase()]
  if (m[2] === '#') pc += 1
  if (m[2] === 'b') pc -= 1
  return (parseInt(m[3], 10) + 1) * 12 + pc
}

/** Index among white keys (C0-relative) for any midi; black keys get the index of the white key to their left. */
export function whiteIndex(midi: number): number {
  const oct = Math.floor(midi / 12)
  const pc = pitchClass(midi)
  const map = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
  return oct * 7 + map[pc]
}

/** Diatonic step (used for staff placement). Natural notes only. */
export function diatonicStep(midi: number): number {
  return whiteIndex(midi)
}

export interface KeyRect {
  midi: number
  x: number
  w: number
  black: boolean
}

/** Expand a range outward to whole octaves (C..B) with at least `minOctaves`. */
export function fitRange(lo: number, hi: number, minOctaves = 2): [number, number] {
  let start = Math.floor(lo / 12) * 12
  let end = Math.floor(hi / 12) * 12 + 11
  let flip = false
  while ((end - start + 1) / 12 < minOctaves) {
    if (flip && start - 12 >= 12) start -= 12
    else end += 12
    flip = !flip
  }
  // keep within an 88-key piano
  start = Math.max(21, start)
  end = Math.min(108, end)
  return [start, end]
}

/** Lay out keys from `lo` to `hi` (inclusive) across `width` px. */
export function layoutKeys(lo: number, hi: number, width: number): { keys: KeyRect[]; whiteW: number } {
  let whites = 0
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++
  const whiteW = width / Math.max(1, whites)
  const blackW = whiteW * 0.62
  const keys: KeyRect[] = []
  const first = whiteIndex(lo)
  // small offsets make black keys sit like a real piano (C#/D# lean out, F#/A# lean out)
  const offset: Record<number, number> = { 1: -0.08, 3: 0.08, 6: -0.1, 8: 0, 10: 0.1 }
  for (let m = lo; m <= hi; m++) {
    const wi = whiteIndex(m) - first
    if (isBlack(m)) {
      const center = (wi + 1) * whiteW + offset[pitchClass(m)] * blackW
      keys.push({ midi: m, x: center - blackW / 2, w: blackW, black: true })
    } else {
      keys.push({ midi: m, x: wi * whiteW, w: whiteW, black: false })
    }
  }
  return { keys, whiteW }
}

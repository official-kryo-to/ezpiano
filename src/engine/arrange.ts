/**
 * Turns raw transcription into a two-hand arrangement for a 61-key keyboard.
 * Pure functions, so the same code runs in the browser, the worker and the tests.
 */
import { toBeats, toSeconds } from './tempo'
import {
  KEY_HIGH,
  KEY_LOW,
  MAX_POLY,
  type ArrangeSettings,
  type ArrangedNote,
  type Arrangement,
  type BeatGrid,
  type Hand,
  type KeyInfo,
  type RawNote,
} from './types'

/* ---------------- key detection ---------------- */

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / 12
  const mb = b.reduce((s, x) => s + x, 0) / 12
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db || 1)
}

/** Krumhansl-Schmuckler key finding on duration-weighted pitch classes. */
export function detectKey(notes: RawNote[]): KeyInfo {
  const hist = new Array(12).fill(0)
  for (const n of notes) hist[n.pitch % 12] += Math.min(2, n.end - n.start) * (n.velocity / 127)
  let best: KeyInfo = { tonic: 0, mode: 'major' }
  let bestR = -Infinity
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, prof] of [
      ['major', MAJOR],
      ['minor', MINOR],
    ] as const) {
      const rotated = Array.from({ length: 12 }, (_, i) => prof[(i - tonic + 12) % 12])
      const r = correlate(hist, rotated)
      if (r > bestR) {
        bestR = r
        best = { tonic, mode }
      }
    }
  }
  return best
}

/** Smallest shift that moves the key to C major or A minor (-5..+6). */
export function easiestKeyShift(key: KeyInfo): number {
  const target = key.mode === 'major' ? 0 : 9
  let s = (((target - key.tonic) % 12) + 12) % 12
  if (s > 6) s -= 12
  return s
}

/* ---------------- melody (skyline) ---------------- */

/** Picks the top line: the highest note of each onset cluster, skipping accompaniment under a held melody note. */
export function skyline(notes: RawNote[]): Set<RawNote> {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch)
  const melody: RawNote[] = []
  let i = 0
  while (i < sorted.length) {
    const t0 = sorted[i].start
    let top = sorted[i]
    let j = i
    while (j < sorted.length && sorted[j].start - t0 < 0.04) {
      if (sorted[j].pitch > top.pitch) top = sorted[j]
      j++
    }
    const cluster = sorted.slice(i, j)
    i = j
    const prev = melody[melody.length - 1]
    const recent = melody.slice(-8).map((n) => n.pitch).sort((a, b) => a - b)
    const center = recent.length ? recent[recent.length >> 1] : null
    // Octave "ghosts": the model sometimes hears a strong 2nd harmonic as a note (common with
    // sampled pianos). A note with its octave-below twin in the same chord is treated as a ghost if
    // a louder note sits between them, or if it is no louder than the twin and jumps away from the tune.
    const ghost = (n: RawNote) => {
      const twin = cluster.find((m) => m.pitch === n.pitch - 12)
      if (!twin) return false
      const louderBetween = cluster.some((m) => m.pitch > twin.pitch && m.pitch < n.pitch && m.velocity >= n.velocity)
      const jump = n.velocity <= twin.velocity * 1.05 && (center === null || n.pitch > center + 5)
      return louderBetween || jump
    }
    const byPitch = [...cluster].sort((a, b) => b.pitch - a.pitch)
    top = byPitch.find((n) => !ghost(n)) ?? top
    if (prev && center !== null) {
      const held = prev.end > top.start + 0.05
      if (held && top.pitch < prev.pitch - 2) continue // accompaniment under a sustained melody note
      if (top.pitch < center - 12) continue // a bass-only moment
    }
    melody.push(top)
  }
  return new Set(melody)
}

/* ---------------- chords ---------------- */

const TRIADS: { name: 'maj' | 'min'; iv: number[] }[] = [
  { name: 'maj', iv: [0, 4, 7] },
  { name: 'min', iv: [0, 3, 7] },
]

interface Chord {
  root: number
  quality: 'maj' | 'min'
  confident: boolean
}

function chordFor(notes: BeatNote[], b0: number, b1: number): Chord | null {
  const w = new Array(12).fill(0)
  let bass: BeatNote | null = null
  for (const n of notes) {
    const ov = Math.min(n.eb, b1) - Math.max(n.sb, b0)
    if (ov <= 0) continue
    w[n.pitch % 12] += ov * (n.pitch < 60 ? 1.6 : 1) * (n.velocity / 127)
    if (n.sb < b0 + 1 && (!bass || n.pitch < bass.pitch)) bass = n
  }
  const total = w.reduce((s, x) => s + x, 0)
  if (total < 0.05) return null
  if (bass) w[bass.pitch % 12] += total * 0.25
  let best: Chord | null = null
  let bestScore = -Infinity
  for (let r = 0; r < 12; r++) {
    for (const t of TRIADS) {
      const inside = t.iv.reduce((s, iv) => s + w[(r + iv) % 12], 0)
      const score = inside - 0.6 * (total - inside) + w[r] * 0.5
      if (score > bestScore) {
        bestScore = score
        best = { root: r, quality: t.name, confident: inside / (total * 1.25) > 0.55 }
      }
    }
  }
  return best
}

/** Left-hand chord accompaniment, one chord per bar (easy) or per half bar. */
function chordAccompaniment(notes: BeatNote[], totalBeats: number, difficulty: ArrangeSettings['difficulty']): BeatNote[] {
  const span = difficulty === 'easy' ? 4 : 2
  const out: BeatNote[] = []
  let prev: { chord: Chord; notes: BeatNote[] } | null = null
  for (let b0 = 0; b0 < totalBeats; b0 += span) {
    const chord = chordFor(notes, b0, b0 + span)
    if (!chord) {
      prev = null
      continue
    }
    const inSeg = notes.filter((n) => n.sb >= b0 && n.sb < b0 + span)
    const vel = inSeg.length ? median(inSeg.map((n) => n.velocity)) * 0.85 : 70
    if (prev && prev.chord.root === chord.root && prev.chord.quality === chord.quality && difficulty !== 'easy') {
      prev.notes.forEach((n) => (n.eb = b0 + span)) // same chord continues: hold it
      continue
    }
    let root = 48 + chord.root // C3..B3
    if (chord.root >= 7) root -= 12 // keep the shape low: G2..B2
    const third = root + (chord.quality === 'maj' ? 4 : 3)
    const fifth = root + 7
    let pitches: number[]
    if (difficulty === 'easy') pitches = chord.confident ? [root, fifth] : [root]
    else if (difficulty === 'medium') pitches = [root, third, fifth]
    else pitches = [root - 12 >= KEY_LOW ? root - 12 : root + 12, root, third, fifth]
    const made = [...new Set(pitches)].map((p) => ({ pitch: p, sb: b0, eb: b0 + span, velocity: vel, src: null }))
    out.push(...made)
    prev = { chord, notes: made }
  }
  return out
}

/* ---------------- helpers ---------------- */

interface BeatNote {
  pitch: number
  sb: number
  eb: number
  velocity: number
  src: RawNote | null
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

function quantize(notes: BeatNote[], step: number) {
  for (const n of notes) {
    const s = Math.round(n.sb / step) * step
    let e = Math.round(n.eb / step) * step
    if (e <= s) e = s + step
    n.sb = s
    n.eb = e
  }
}

/** Same key twice at once is impossible to play: merge duplicates and cut overlaps. */
function dedupe(notes: BeatNote[]): BeatNote[] {
  const byPitch = new Map<number, BeatNote[]>()
  for (const n of notes) {
    const l = byPitch.get(n.pitch) ?? []
    l.push(n)
    byPitch.set(n.pitch, l)
  }
  const out: BeatNote[] = []
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.sb - b.sb || b.eb - a.eb)
    let prev: BeatNote | null = null
    for (const n of list) {
      if (prev && Math.abs(n.sb - prev.sb) < 1e-6) {
        prev.eb = Math.max(prev.eb, n.eb)
        prev.velocity = Math.max(prev.velocity, n.velocity)
        continue
      }
      if (prev && prev.eb > n.sb) prev.eb = n.sb
      out.push(n)
      prev = n
    }
  }
  return out.filter((n) => n.eb - n.sb > 1e-6)
}

/**
 * Enforce a polyphony cap. Earlier notes that are still ringing get shortened first; if a chord
 * itself is too big, the least important notes are dropped (RH keeps the top, LH keeps bass + top).
 */
export function capPolyphony(notes: BeatNote[], cap: number, hand: Hand): BeatNote[] {
  const priority = (group: BeatNote[]) => {
    const byPitch = [...group].sort((a, b) => b.pitch - a.pitch)
    if (hand === 'R') return byPitch
    const low = byPitch[byPitch.length - 1]
    return [low, ...byPitch.filter((n) => n !== low)]
  }
  const sorted = [...notes].sort((a, b) => a.sb - b.sb)
  const groups: BeatNote[][] = []
  for (const n of sorted) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(g[0].sb - n.sb) < 1e-6) g.push(n)
    else groups.push([n])
  }
  const kept: BeatNote[] = []
  let active: BeatNote[] = []
  for (const g of groups) {
    const t = g[0].sb
    active = active.filter((a) => a.eb > t + 1e-6)
    for (const n of priority(g)) {
      while (active.length >= cap) {
        const earlier = active.filter((a) => a.sb < t - 1e-6).sort((a, b) => a.sb - b.sb)[0]
        if (!earlier) break
        earlier.eb = t
        active = active.filter((a) => a !== earlier)
      }
      if (active.length >= cap) continue // chord too big: drop the least important notes
      kept.push(n)
      active.push(n)
    }
  }
  return kept
}

/** Shift by octaves until the note fits the 61 keys. Never drops notes. */
export function fitRange(pitch: number): number {
  let p = pitch
  while (p < KEY_LOW) p += 12
  while (p > KEY_HIGH) p -= 12
  return p
}

const clampVelocity = (v: number) => Math.max(40, Math.min(110, Math.round(v)))

/* ---------------- main ---------------- */

export function arrange(raw: RawNote[], grid: BeatGrid, s: ArrangeSettings): Arrangement {
  const key = detectKey(raw)
  const shift = s.autoTranspose ? easiestKeyShift(key) : Math.max(-12, Math.min(12, Math.round(s.transpose)))
  const beats = grid.beats
  const asBeats = (n: RawNote): BeatNote => ({
    pitch: n.pitch,
    sb: toBeats(n.start, beats),
    eb: toBeats(n.end, beats),
    velocity: n.velocity,
    src: n,
  })

  const all = raw.map(asBeats)
  const melodySet = skyline(raw)
  const melody = all.filter((n) => n.src && melodySet.has(n.src))
  const rest = all.filter((n) => !(n.src && melodySet.has(n.src)))
  const totalBeats = Math.ceil(all.reduce((m, n) => Math.max(m, n.eb), 0))

  let rh: BeatNote[] = melody
  let lh: BeatNote[] = []
  if (s.output === 'chords' || (s.output === 'full' && s.difficulty === 'easy')) {
    lh = chordAccompaniment(all, totalBeats, s.difficulty)
  } else if (s.output === 'full') {
    // inner voices close under the melody go to the right hand, everything else to the left
    const melodyAt = (b: number) => melody.find((m) => m.sb <= b + 0.05 && m.eb > b)
    const inner: BeatNote[] = []
    for (const n of rest) {
      const m = melodyAt(n.sb)
      if (n.pitch >= 60 && m && n.pitch < m.pitch && m.pitch - n.pitch <= 12) inner.push(n)
      else lh.push(n)
    }
    rh = [...melody, ...inner]
  }

  const rhCap = s.output === 'full' ? MAX_POLY[s.difficulty].R : 1
  const lhCap = MAX_POLY[s.difficulty].L

  const finish = (list: BeatNote[], hand: Hand, cap: number) => {
    let notes = list.map((n) => ({ ...n }))
    if (s.quantize) quantize(notes, s.difficulty === 'easy' ? 0.5 : 0.25)
    for (const n of notes) n.pitch = fitRange(n.pitch + shift)
    notes = dedupe(notes)
    notes = capPolyphony(notes, cap, hand)
    return notes
  }

  const notes: ArrangedNote[] = [
    ...finish(rh, 'R', rhCap).map((n) => ({ n, hand: 'R' as Hand })),
    ...finish(lh, 'L', lhCap).map((n) => ({ n, hand: 'L' as Hand })),
  ]
    .map(({ n, hand }) => {
      const sb = Math.max(0, n.sb)
      const eb = Math.max(sb + 0.05, n.eb)
      return {
        pitch: n.pitch,
        startBeat: sb,
        endBeat: eb,
        start: toSeconds(sb, beats) - beats[0],
        end: toSeconds(eb, beats) - beats[0],
        velocity: clampVelocity(n.velocity),
        hand,
      }
    })
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch)

  const duration = notes.reduce((m, n) => Math.max(m, n.end), 0)
  return { notes, grid, key, transpose: shift, duration }
}

/** Seconds per beat at beat index b (for display and MIDI tempo maps). */
export function beatLength(grid: BeatGrid, b: number) {
  const i = Math.max(0, Math.min(grid.beats.length - 2, Math.floor(b)))
  return grid.beats[i + 1] - grid.beats[i]
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
export const keyName = (k: KeyInfo) => `${NOTE_NAMES[k.tonic]} ${k.mode}`

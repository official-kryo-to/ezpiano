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

// Temperley (Kostka-Payne) profiles find the key signature best; Albrecht & Shanahan (2013)
// profiles then tell major from minor. On 61 pop piano excerpts with annotated keys this gets
// 97% of keys and 98% of key signatures right (plain Krumhansl-Kessler: 90% / 92%).
const TEMPERLEY = [
  [5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 1.5, 4],
  [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 1.5, 4],
]
const ALBRECHT_SHANAHAN = [
  [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008, 0.081],
  [0.22, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052],
]

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

const rotate = (profile: number[], tonic: number) => Array.from({ length: 12 }, (_, i) => profile[(i - tonic + 12) % 12])

/** Key of the piece: Temperley (bass-weighted) for the key signature, Albrecht-Shanahan for major vs minor. */
export function detectKey(notes: RawNote[]): KeyInfo {
  const plain = new Array(12).fill(0)
  const bassy = new Array(12).fill(0)
  for (const n of notes) {
    const w = Math.min(2, n.end - n.start) * (n.velocity / 127)
    plain[n.pitch % 12] += w
    bassy[n.pitch % 12] += w * (n.pitch < 60 ? 2 : 1)
  }
  let sigTonic = 0 // tonic of the major key with the detected key signature
  let bestR = -Infinity
  for (let t = 0; t < 12; t++) {
    for (const m of [0, 1]) {
      const r = correlate(bassy, rotate(TEMPERLEY[m], t))
      if (r > bestR) {
        bestR = r
        sigTonic = m ? (t + 3) % 12 : t
      }
    }
  }
  const minorTonic = (sigTonic + 9) % 12
  const rMajor = correlate(plain, rotate(ALBRECHT_SHANAHAN[0], sigTonic))
  const rMinor = correlate(plain, rotate(ALBRECHT_SHANAHAN[1], minorTonic))
  return rMinor > rMajor ? { tonic: minorTonic, mode: 'minor' } : { tonic: sigTonic, mode: 'major' }
}

/** Smallest shift that moves the key to C major or A minor (-5..+6). */
export function easiestKeyShift(key: KeyInfo): number {
  const target = key.mode === 'major' ? 0 : 9
  let s = (((target - key.tonic) % 12) + 12) % 12
  if (s > 6) s -= 12
  return s
}

/* ---------------- melody (skyline) ---------------- */

export interface MelodyParams {
  /** weight of loudness relative to the surroundings */
  vel: number
  /** bonus for being the top note of its onset cluster */
  top: number
  /** weight of height relative to the local upper register */
  height: number
  /** weight of (log) note length */
  dur: number
  /** base score of any note; acts as the inclusion threshold */
  bias: number
  /** penalty per octave of leap beyond `leapFree` semitones */
  leap: number
  leapFree: number
}

// fitted on 16 POP909 songs (dry + cover-style audio), validated on 16 others: melody F1 0.51 -> 0.67
export const MELODY_DEFAULTS: MelodyParams = { vel: 3.5, top: 1.2, height: 0, dur: 0, bias: 0, leap: 6, leapFree: 3 }

/**
 * Melody line by dynamic programming. Every note gets a salience score (loud for its
 * surroundings, top of its chord, high in the local register, long); the melody is the
 * monophonic path with the highest total, where big leaps cost extra and rests are free.
 * Much better than "always take the top note" on pop arrangements, where right-hand
 * accompaniment often sits above the tune.
 */
export function extractMelody(notes: RawNote[], p: MelodyParams = MELODY_DEFAULTS): Set<RawNote> {
  const ns = [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch)
  const n = ns.length
  if (!n) return new Set()
  const starts = ns.map((x) => x.start)
  const bound = (t: number) => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (starts[m] < t) lo = m + 1
      else hi = m
    }
    return lo
  }
  // onset clusters
  const rank = new Int32Array(n)
  const ghost = new Uint8Array(n)
  for (let i = 0; i < n; ) {
    let j = i
    while (j < n && ns[j].start - ns[i].start < 0.04) j++
    const cl = ns.slice(i, j).sort((a, b) => b.pitch - a.pitch)
    for (let k = i; k < j; k++) {
      const note = ns[k]
      rank[k] = cl.indexOf(note)
      const twin = cl.find((m) => m.pitch === note.pitch - 12)
      if (twin) {
        const louderBetween = cl.some((m) => m.pitch > twin.pitch && m.pitch < note.pitch && m.velocity >= note.velocity)
        if (louderBetween || note.velocity < twin.velocity * 0.8) ghost[k] = 1
      }
    }
    i = j
  }
  // salience
  const sal = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const lo = bound(ns[i].start - 2)
    const hi = bound(ns[i].start + 2)
    const vels = []
    const pitches = []
    for (let k = lo; k < hi; k++) {
      vels.push(ns[k].velocity)
      pitches.push(ns[k].pitch)
    }
    vels.sort((a, b) => a - b)
    pitches.sort((a, b) => a - b)
    const medV = vels[vels.length >> 1]
    const upper = pitches[Math.floor(pitches.length * 0.85)]
    const x = ns[i]
    const d = Math.max(-2, Math.min(2, Math.log2(Math.max(0.05, x.end - x.start) / 0.3)))
    sal[i] =
      p.vel * ((x.velocity - medV) / 15) +
      p.top * (rank[i] === 0 ? 1 : rank[i] === 1 ? 0.25 : 0) +
      p.height * ((x.pitch - upper) / 12) +
      p.dur * d +
      p.bias -
      (ghost[i] ? 4 : 0)
  }
  // DP over a monophonic path
  const best = new Float64Array(n)
  const prev = new Int32Array(n).fill(-1)
  const LOOKBACK = 3
  let farBest = 0 // best path ending long ago (after a long rest, any leap is fine)
  let farArg = -1
  let farPtr = 0
  for (let i = 0; i < n; i++) {
    while (farPtr < i && ns[farPtr].start <= ns[i].start - LOOKBACK) {
      if (best[farPtr] > farBest) {
        farBest = best[farPtr]
        farArg = farPtr
      }
      farPtr++
    }
    let b = farBest
    let arg = farArg
    for (let j = i - 1; j >= farPtr; j--) {
      const gap = ns[i].start - ns[j].start
      if (gap < 0.05) continue
      const leap = Math.max(0, Math.abs(ns[i].pitch - ns[j].pitch) - p.leapFree) / 12
      const v = best[j] - p.leap * leap
      if (v > b) {
        b = v
        arg = j
      }
    }
    best[i] = sal[i] + Math.max(0, b)
    prev[i] = b > 0 ? arg : -1
  }
  let end = 0
  for (let i = 1; i < n; i++) if (best[i] > best[end]) end = i
  const out = new Set<RawNote>()
  for (let i = end; i >= 0; i = prev[i]) {
    out.add(ns[i])
    if (prev[i] < 0) break
  }
  return out
}

/** Old top-note melody, kept for comparison in the dev tools. */
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

/** Shift by octaves until the note fits the keys. Never drops notes. */
export function fitRange(pitch: number, low = KEY_LOW, high = KEY_HIGH): number {
  let p = pitch
  while (p < low) p += 12
  while (p > high) p -= 12
  return Math.max(low, Math.min(high, p)) // only matters for ranges under an octave
}

const clampVelocity = (v: number) => Math.max(40, Math.min(110, Math.round(v)))

/* ---------------- main ---------------- */

export function arrange(raw: RawNote[], grid: BeatGrid, s: ArrangeSettings): Arrangement {
  const low = s.range?.low ?? KEY_LOW
  const high = s.range?.high ?? KEY_HIGH
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
  const melodySet = extractMelody(raw)
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
    for (const n of notes) n.pitch = fitRange(n.pitch + shift, low, high)
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

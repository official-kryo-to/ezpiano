/**
 * Tempo and beat analysis from transcribed notes (no audio needed, no third-party deps).
 *
 * 1. Onset events: notes starting within 35 ms are one event, weighted by loudness (bass counts more).
 * 2. Global tempo: inter-onset-interval histogram over all event pairs up to 3 s apart, scored at
 *    the beat period and its multiples, times a soft prior around 110 BPM.
 * 3. Beats: dynamic-programming beat tracker (Ellis 2007) on an onset envelope, so tempo drift in
 *    live covers is followed. If the beats are steady, they are replaced by a perfect grid.
 * 4. Downbeat: the beat phase (mod 4) where bass notes and big chords land most often.
 */
import type { BeatGrid, RawNote } from './types'

const ENV_FPS = 100

/** Tunable constants (fitted on a pop piano dev set, see README). */
export const TEMPO_PARAMS = {
  /** soft tempo prior: centre (BPM) and width (octaves) */
  center: 80,
  width: 0.7,
  /** downbeat cue weights */
  accent: 2,
  harmony: 0.5,
  start: 0.35,
  long: 0,
  /** shift the grid by half a beat when the off-beats carry this much more weight */
  offbeat: 1.15,
}

/**
 * Syncopated accompaniment can pull a beat tracker onto the off-beats. Bass notes and long notes
 * mostly sit on the beat, so compare the grid with its half-beat-shifted copy.
 */
function onBeatCheck(notes: RawNote[], beats: number[]): number[] {
  if (beats.length < 4) return beats
  const weight = (n: RawNote) => (n.velocity / 127) * (n.pitch < 55 ? 2 : 1) * Math.min(1.5, (n.end - n.start) / 0.3)
  const score = (grid: number[]) => {
    let s = 0
    let k = 0
    for (const n of notes) {
      while (k + 1 < grid.length && grid[k + 1] <= n.start) k++
      const d = Math.min(Math.abs(n.start - grid[k]), k + 1 < grid.length ? Math.abs(grid[k + 1] - n.start) : Infinity)
      if (d < 0.06) s += weight(n)
    }
    return s
  }
  const period = beats[1] - beats[0]
  const ext = [...beats]
  while (ext[0] > notes[0].start - period) ext.unshift(ext[0] - period)
  beats = ext
  const shifted = [beats[0] - period / 2, ...beats.slice(0, -1).map((b, i) => (b + beats[i + 1]) / 2)]
  // Bass and long notes decide when the evidence is clear. Otherwise the song's first note
  // (almost always on a beat) breaks the tie.
  const ratio = score(shifted) / Math.max(1e-9, score(beats))
  if (ratio > 1.4) return shifted
  if (ratio < 1 / 1.4) return beats
  const first = notes[0].start
  const dist = (grid: number[]) => Math.min(...grid.map((b) => Math.abs(b - first)))
  const half = period / 2
  const onOrig = dist(beats) < half * 0.35
  const onShift = dist(shifted) < half * 0.35
  if (onShift && !onOrig) return shifted
  if (onOrig && !onShift) return beats
  return ratio > TEMPO_PARAMS.offbeat ? shifted : beats
}

interface OnsetEvent {
  t: number
  w: number
  bass: number
}

function onsetEvents(notes: RawNote[]): OnsetEvent[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const events: OnsetEvent[] = []
  for (const n of sorted) {
    const w = (n.velocity / 127) * (n.pitch < 55 ? 1.5 : 1)
    const last = events[events.length - 1]
    if (last && n.start - last.t < 0.035) {
      last.w += w
      if (n.pitch < 55) last.bass += 1
    } else events.push({ t: n.start, w, bass: n.pitch < 55 ? 1 : 0 })
  }
  return events
}

/** Global beat period (seconds) from an inter-onset-interval histogram. */
export function estimatePeriod(events: OnsetEvent[]): number {
  const BIN = 0.005
  const MAXLAG = 3
  const hist = new Float64Array(Math.ceil(MAXLAG / BIN) + 1)
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length && j - i <= 16; j++) {
      const d = events[j].t - events[i].t
      if (d > MAXLAG) break
      if (d < 0.08) continue
      hist[Math.round(d / BIN)] += Math.sqrt(events[i].w * events[j].w)
    }
  }
  // gaussian smoothing (sigma 15 ms)
  const sm = new Float64Array(hist.length)
  const R = 9
  const kernel = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / 3) ** 2))
  for (let i = 0; i < hist.length; i++) {
    let s = 0
    for (let k = -R; k <= R; k++) {
      const j = i + k
      if (j >= 0 && j < hist.length) s += hist[j] * kernel[k + R]
    }
    sm[i] = s
  }
  const h = (sec: number) => {
    const x = sec / BIN
    const i = Math.floor(x)
    if (i < 0 || i + 1 >= sm.length) return 0
    return sm[i] + (sm[i + 1] - sm[i]) * (x - i)
  }
  let best = 0.5
  let bestScore = -1
  for (let p = 0.3; p <= 1.2; p += 0.002) {
    const bpm = 60 / p
    const prior = Math.exp(-0.5 * (Math.log2(bpm / TEMPO_PARAMS.center) / TEMPO_PARAMS.width) ** 2)
    const score = (h(p) + 0.7 * h(2 * p) + 0.5 * h(3 * p) + 0.5 * h(4 * p) + 0.4 * h(p / 2)) * prior
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}

function envelope(events: OnsetEvent[], frames: number): Float64Array {
  const env = new Float64Array(frames)
  for (const e of events) {
    const c = e.t * ENV_FPS
    for (let k = -4; k <= 4; k++) {
      const i = Math.round(c) + k
      if (i >= 0 && i < frames) env[i] += e.w * Math.exp(-0.5 * ((i - c) / 2) ** 2)
    }
  }
  let mean = 0
  for (const v of env) mean += v
  mean /= frames || 1
  let sd = 0
  for (const v of env) sd += (v - mean) ** 2
  sd = Math.sqrt(sd / (frames || 1)) || 1
  for (let i = 0; i < frames; i++) env[i] /= sd
  return env
}

/** Dynamic-programming beat tracker. Returns beat times in seconds. */
function trackBeats(env: Float64Array, period: number, tightness = 100): number[] {
  const P = period * ENV_FPS
  const n = env.length
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  const lo = Math.round(P / 2)
  const hi = Math.round(P * 2)
  for (let t = 0; t < n; t++) {
    let best = 0
    let arg = -1
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue
      const s = score[tau] - tightness * Math.log((t - tau) / P) ** 2
      if (arg < 0 || s > best) {
        best = s
        arg = tau
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0)
    back[t] = arg >= 0 && best > 0 ? arg : -1
  }
  // end on the best-scoring frame in the last beat period
  let end = n - 1
  for (let t = Math.max(0, n - Math.round(P)); t < n; t++) if (score[t] > score[end]) end = t
  const beats: number[] = []
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t / ENV_FPS)
    if (back[t] < 0) break
  }
  return beats.reverse()
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

/** Analyse tempo, beats and downbeat. Beats start at the downbeat at or before the first note. */
export function analyzeTempo(notes: RawNote[]): BeatGrid {
  if (!notes.length) return { bpm: 120, beats: [0], steady: true }
  const events = onsetEvents(notes)
  const first = events[0].t
  const last = notes.reduce((m, n) => Math.max(m, n.end), 0)
  const period = events.length >= 4 ? estimatePeriod(events) : 0.5

  let beats: number[]
  let steady = true
  if (events.length >= 8) {
    const env = envelope(events, Math.ceil((last + 1) * ENV_FPS))
    const tracked = trackBeats(env, period)
    const ibis = tracked.slice(1).map((b, i) => b - tracked[i])
    const m = ibis.length ? median(ibis) : period
    const cv = ibis.length > 3 ? Math.sqrt(ibis.reduce((s, x) => s + (x - m) ** 2, 0) / ibis.length) / m : 0
    steady = cv < 0.04 || tracked.length < 6
    if (steady) {
      // least-squares straight line through the tracked beats -> one exact tempo
      beats = fitGrid(tracked.length >= 2 ? tracked : [first], tracked.length >= 2 ? m : period)
    } else {
      beats = smooth(tracked)
    }
  } else {
    beats = [first]
    for (let t = first + period; t < last; t += period) beats.push(t)
  }

  beats = onBeatCheck(notes, beats)

  // cover the whole piece
  const p0 = beats.length > 1 ? beats[1] - beats[0] : period
  while (beats[0] > first - 0.05) beats.unshift(beats[0] - p0)
  const p1 = beats.length > 1 ? beats[beats.length - 1] - beats[beats.length - 2] : period
  while (beats[beats.length - 1] < last + p1) beats.push(beats[beats.length - 1] + p1)

  const phase = downbeatPhase(notes, events, beats, first)
  // first downbeat at or just before the first note (trims leading silence to < 1 bar)
  let startIdx = phase
  while (startIdx + 4 < beats.length && beats[startIdx + 4] <= first + 0.05) startIdx += 4
  if (beats[startIdx] > first + 0.05) {
    // extrapolate one more bar backwards
    const p = beats[1] - beats[0]
    for (let i = 0; i < 4; i++) beats.unshift(beats[0] - p)
    startIdx += 4
    while (startIdx - 4 >= 0 && beats[startIdx] > first + 0.05) startIdx -= 4
  }
  beats = beats.slice(startIdx)

  const ibis = beats.slice(1).map((b, i) => b - beats[i])
  const bpm = Math.round((60 / median(ibis)) * 10) / 10
  return { bpm, beats, steady }
}

/**
 * Which beat (mod 4) is beat 1? Three cues, each normalised to 0..1:
 *  - accent: loud events and bass notes on the beat
 *  - harmony: how much the pitch content changes across the beat (chords change on beat 1)
 *  - start: songs usually begin on beat 1
 */
function downbeatPhase(notes: RawNote[], events: OnsetEvent[], beats: number[], first: number): number {
  const accent = beats.map((b) => {
    let s = 0
    for (const e of events) if (Math.abs(e.t - b) < 0.07) s += e.w + e.bass * 0.8
    return s
  })
  // pitch-class profile of each beat span
  const prof = beats.map(() => new Float64Array(12))
  for (const n of notes) {
    for (let i = 0; i + 1 < beats.length; i++) {
      const ov = Math.min(n.end, beats[i + 1]) - Math.max(n.start, beats[i])
      if (ov > 0) prof[i][n.pitch % 12] += ov * (n.pitch < 60 ? 2 : 1)
      if (beats[i] > n.end) break
    }
  }
  const window = (from: number, to: number) => {
    const v = new Float64Array(12)
    for (let i = Math.max(0, from); i < Math.min(prof.length, to); i++) for (let k = 0; k < 12; k++) v[k] += prof[i][k]
    return v
  }
  const harmony = beats.map((_, i) => {
    const a = window(i - 2, i)
    const b = window(i, i + 2)
    let dot = 0
    let na = 0
    let nb = 0
    for (let k = 0; k < 12; k++) {
      dot += a[k] * b[k]
      na += a[k] * a[k]
      nb += b[k] * b[k]
    }
    return na && nb ? 1 - dot / Math.sqrt(na * nb) : 0
  })
  const firstBeat = beats.reduce((bi, b, i) => (Math.abs(b - first) < Math.abs(beats[bi] - first) ? i : bi), 0)
  const sumBy = (xs: number[]) => [0, 1, 2, 3].map((k) => xs.reduce((s, x, i) => (i % 4 === k ? s + x : s), 0))
  const norm = (xs: number[]) => {
    const m = Math.max(...xs)
    return m > 0 ? xs.map((x) => x / m) : xs
  }
  // long notes (held chords, melody notes) tend to start on beat 1
  const longStarts = beats.map((b) => {
    let s = 0
    for (const n of notes) if (Math.abs(n.start - b) < 0.07) s += Math.min(4, n.end - n.start)
    return s
  })
  const acc = norm(sumBy(accent))
  const har = norm(sumBy(harmony))
  const lng = norm(sumBy(longStarts))
  const P = TEMPO_PARAMS
  let best = 0
  let bestScore = -1
  for (let k = 0; k < 4; k++) {
    const score = P.accent * acc[k] + P.harmony * har[k] + P.long * lng[k] + (firstBeat % 4 === k ? P.start : 0)
    if (score > bestScore) {
      bestScore = score
      best = k
    }
  }
  return best
}

function fitGrid(tracked: number[], period: number): number[] {
  const n = tracked.length
  if (n < 2) return [tracked[0]]
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  tracked.forEach((y, x) => {
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
  })
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx) || period
  const icpt = (sy - slope * sx) / n
  return tracked.map((_, i) => icpt + slope * i)
}

/** Light smoothing of beat times (3-tap) to avoid jittery tempo changes. */
function smooth(beats: number[]): number[] {
  if (beats.length < 3) return beats
  return beats.map((b, i) => (i === 0 || i === beats.length - 1 ? b : 0.25 * beats[i - 1] + 0.5 * b + 0.25 * beats[i + 1]))
}

/** Seconds -> beats (float), piecewise linear through the beat grid, extrapolated at the ends. */
export function toBeats(t: number, beats: number[]): number {
  const n = beats.length
  if (n < 2) return t / 0.5
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0])
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2])
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (beats[mid] <= t) lo = mid
    else hi = mid
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo])
}

/** Beats (float) -> seconds, inverse of toBeats. */
export function toSeconds(b: number, beats: number[]): number {
  const n = beats.length
  if (n < 2) return b * 0.5
  if (b <= 0) return beats[0] + b * (beats[1] - beats[0])
  if (b >= n - 1) return beats[n - 1] + (b - (n - 1)) * (beats[n - 1] - beats[n - 2])
  const i = Math.floor(b)
  return beats[i] + (b - i) * (beats[i + 1] - beats[i])
}

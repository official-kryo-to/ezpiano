import type { RawNote } from './types'

export const MIN_NOTE_SECONDS = 0.06

/**
 * Light cleanup of raw transcription:
 *  - merge repeated fragments of the same key (double detections, a held note split in two)
 *  - drop notes shorter than ~60 ms when they are also weak (otherwise lengthen them to 60 ms)
 *  - drop ghost notes: very quiet, or much quieter than what is playing around them
 */
export function cleanNotes(input: RawNote[]): RawNote[] {
  const byPitch = new Map<number, RawNote[]>()
  for (const n of input) {
    if (!(n.end > n.start)) continue
    const list = byPitch.get(n.pitch) ?? []
    list.push({ ...n })
    byPitch.set(n.pitch, list)
  }

  let merged: RawNote[] = []
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start)
    const out: RawNote[] = []
    for (const n of list) {
      const prev = out[out.length - 1]
      if (prev) {
        const doubleHit = n.start - prev.start < 0.08
        const fragment = n.start - prev.end < 0.03 && n.velocity < prev.velocity * 0.75
        if (doubleHit || fragment) {
          prev.end = Math.max(prev.end, n.end)
          prev.velocity = Math.max(prev.velocity, n.velocity)
          continue
        }
      }
      out.push(n)
    }
    merged = merged.concat(out)
  }

  merged.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  // Short notes: in fast or staccato playing the model reports many real notes at 30-60 ms, so
  // length alone says nothing. Drop a short note only when it is also weak for its surroundings;
  // keep the rest and give them a playable minimum length.
  const startsAll = merged.map((n) => n.start)
  merged = merged.filter((n) => {
    if (n.end - n.start >= MIN_NOTE_SECONDS) return true
    const lo = lowerBound(startsAll, n.start - 1)
    const hi = lowerBound(startsAll, n.start + 1)
    const vels = merged.slice(lo, hi).map((m) => m.velocity).sort((a, b) => a - b)
    const median = vels[vels.length >> 1] ?? n.velocity
    return n.end - n.start >= 0.02 && n.velocity >= median * 0.7
  })
  for (const n of merged) if (n.end - n.start < MIN_NOTE_SECONDS) n.end = n.start + MIN_NOTE_SECONDS

  // octave ghosts: a clearly quieter note exactly one or two octaves above a note struck together
  merged = merged.filter((n, i) => {
    for (let j = i - 1; j >= 0 && n.start - merged[j].start < 0.03; j--) {
      const m = merged[j]
      if ((n.pitch - m.pitch === 12 || n.pitch - m.pitch === 24) && n.velocity < m.velocity * 0.8) return false
    }
    for (let j = i + 1; j < merged.length && merged[j].start - n.start < 0.03; j++) {
      const m = merged[j]
      if ((n.pitch - m.pitch === 12 || n.pitch - m.pitch === 24) && n.velocity < m.velocity * 0.8) return false
    }
    return true
  })

  // ghost notes, relative to the local loudness (median velocity within +-1.5 s)
  const starts = merged.map((n) => n.start)
  const kept = merged.filter((n) => {
    if (n.velocity < 14) return false
    const lo = lowerBound(starts, n.start - 1.5)
    const hi = lowerBound(starts, n.start + 1.5)
    if (hi - lo < 6) return true
    const vels = merged.slice(lo, hi).map((m) => m.velocity).sort((a, b) => a - b)
    const median = vels[vels.length >> 1]
    return n.velocity >= median * 0.35
  })
  return kept
}

export function lowerBound(arr: number[], x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

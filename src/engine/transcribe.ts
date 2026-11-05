import { RollStitcher, rollsToNotes, segmentStarts, sliceSegment } from './kong'
import type { RawNote } from './types'

/** Runs the piano model on one 10 s window and returns the 4 rolls (ROLL_NAMES order). */
export interface SegmentRunner {
  run(segment: Float32Array): Promise<Float32Array[]>
}

/**
 * Hop between 10 s windows. The reference uses 5 s (50% overlap); 7.5 s keeps 1.25 s of context
 * on each side and was measured to give the same accuracy (see README benchmark) for 33% less work.
 */
export const DEFAULT_HOP_SECONDS = 7.5

export async function transcribePiano(
  audio16k: Float32Array,
  runner: SegmentRunner,
  opts: { hopSeconds?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<RawNote[]> {
  const hop = opts.hopSeconds ?? DEFAULT_HOP_SECONDS
  const starts = segmentStarts(audio16k.length, hop)
  const stitcher = new RollStitcher(starts.length, audio16k.length, hop)
  opts.onProgress?.(0, starts.length)
  for (let i = 0; i < starts.length; i++) {
    stitcher.push(await runner.run(sliceSegment(audio16k, starts[i])))
    opts.onProgress?.(i + 1, starts.length)
  }
  return rollsToNotes(stitcher.finish())
}

/** Pack notes for postMessage / IndexedDB: [pitch, start, end, velocity] * n */
export function packNotes(notes: RawNote[]): Float32Array {
  const out = new Float32Array(notes.length * 4)
  notes.forEach((n, i) => out.set([n.pitch, n.start, n.end, n.velocity], i * 4))
  return out
}

export function unpackNotes(buf: Float32Array): RawNote[] {
  const out: RawNote[] = []
  for (let i = 0; i + 3 < buf.length; i += 4) out.push({ pitch: buf[i], start: buf[i + 1], end: buf[i + 2], velocity: buf[i + 3] })
  return out
}

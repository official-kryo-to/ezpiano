import { KEYS, RollStitcher, SAMPLE_RATE, SEGMENT_FRAMES, rollsToNotes, segmentStarts, sliceSegment } from './kong'
import { prepareAudio, type PreprocessMode } from './preprocess'
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
  opts: {
    hopSeconds?: number
    preprocess?: PreprocessMode
    onProgress?: (done: number, total: number) => void
    /** rough notes of each window as soon as it is done, for a live preview */
    onPartial?: (notes: RawNote[]) => void
  } = {},
): Promise<RawNote[]> {
  const hop = opts.hopSeconds ?? DEFAULT_HOP_SECONDS
  // bring loud, mastered covers back to the level the model was trained on
  audio16k = prepareAudio(audio16k, opts.preprocess ?? 'rms')
  const starts = segmentStarts(audio16k.length, hop)
  const stitcher = new RollStitcher(starts.length, audio16k.length, hop)
  opts.onProgress?.(0, starts.length)
  for (let i = 0; i < starts.length; i++) {
    const seg = sliceSegment(audio16k, starts[i])
    // near-silent windows (intros, endings, pauses) cannot contain notes: skip the model
    const silent = isSilent(seg)
    const out = silent ? silentRolls() : await runner.run(seg)
    stitcher.push(out)
    if (opts.onPartial && !silent) {
      // notes of this window's own stretch of the song (the part the stitcher keeps)
      const ctx = (10 - hop) / 2
      const from = i === 0 ? 0 : ctx
      const to = i === starts.length - 1 ? 10 : ctx + hop
      const t0 = starts[i] / SAMPLE_RATE
      const [onset, offset, frame, velocity] = out
      const part = rollsToNotes({ frames: SEGMENT_FRAMES, onset, offset, frame, velocity })
        .filter((n) => n.start >= from && n.start < to)
        .map((n) => ({ ...n, start: n.start + t0, end: n.end + t0 }))
      opts.onPartial(part)
    }
    opts.onProgress?.(i + 1, starts.length)
  }
  return rollsToNotes(stitcher.finish())
}

/** The whole window peaks below -60 dBFS. */
export function isSilent(seg: Float32Array): boolean {
  let peak = 0
  for (let i = 0; i < seg.length; i++) {
    const v = Math.abs(seg[i])
    if (v > peak) peak = v
  }
  return peak < 0.001
}

function silentRolls(): Float32Array[] {
  return [0, 1, 2, 3].map(() => new Float32Array(SEGMENT_FRAMES * KEYS))
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

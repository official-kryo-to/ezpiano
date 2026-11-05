/**
 * Helpers for the ByteDance "High-resolution Piano Transcription" model (Kong et al., 2021).
 *
 * The model takes 10 s of 16 kHz audio and returns four frame-level rolls at 100 fps
 * over the 88 piano keys: onset regression, offset regression, frame activity and velocity.
 * This file ports the reference post-processing (RegressionPostProcessor + piano_vad) from
 * `piano_transcription_inference` (MIT, github.com/qiuqiangkong/piano_transcription_inference).
 */
import type { RawNote } from './types'

export const SAMPLE_RATE = 16000
export const FPS = 100
export const SEGMENT_SAMPLES = SAMPLE_RATE * 10
export const SEGMENT_FRAMES = SEGMENT_SAMPLES / (SAMPLE_RATE / FPS) + 1 // 1001
export const KEYS = 88
export const BEGIN_NOTE = 21

export interface Rolls {
  frames: number
  onset: Float32Array // frames * 88
  offset: Float32Array
  frame: Float32Array
  velocity: Float32Array
}

export const ROLL_NAMES = ['reg_onset_output', 'reg_offset_output', 'frame_output', 'velocity_output'] as const

/**
 * Windows are 10 s long. `hopSeconds` sets how far apart they start: the reference code uses 5 s
 * (50% overlap, 2.5 s of context thrown away on each side). Less overlap is faster.
 */
export function segmentStarts(numSamples: number, hopSeconds = 5): number[] {
  const hop = Math.round(hopSeconds * SAMPLE_RATE)
  const count = Math.max(1, Math.ceil(Math.max(0, numSamples - SEGMENT_SAMPLES) / hop) + 1)
  return Array.from({ length: count }, (_, i) => i * hop)
}

export function sliceSegment(audio: Float32Array, start: number): Float32Array {
  const seg = new Float32Array(SEGMENT_SAMPLES)
  seg.set(audio.subarray(start, Math.min(audio.length, start + SEGMENT_SAMPLES)))
  return seg
}

/**
 * Stitches per-segment outputs into one roll per output (reference `deframe`, generalised to any
 * hop): every window keeps its centre, the first keeps its start and the last keeps its end.
 */
export class RollStitcher {
  private rolls: Float32Array[]
  private count = 0
  private hopFrames: number
  private ctxFrames: number
  readonly frames: number

  constructor(
    private total: number,
    numSamples: number,
    hopSeconds = 5,
  ) {
    this.hopFrames = Math.round(hopSeconds * FPS)
    this.ctxFrames = Math.round((SEGMENT_FRAMES - 1 - this.hopFrames) / 2)
    this.frames = Math.ceil((numSamples / SAMPLE_RATE) * FPS) + 1
    this.rolls = [0, 1, 2, 3].map(() => new Float32Array(this.frames * KEYS))
  }

  /** outputs: the four rolls for one segment, each SEGMENT_FRAMES * 88, in ROLL_NAMES order */
  push(outputs: Float32Array[]) {
    const i = this.count++
    const usable = SEGMENT_FRAMES - 1
    const from = i === 0 ? 0 : this.ctxFrames
    const to = i === this.total - 1 ? usable + 1 : this.ctxFrames + this.hopFrames
    const offset = i * this.hopFrames
    for (let k = 0; k < 4; k++) {
      const lo = from
      const hi = Math.min(to, this.frames - offset)
      if (hi <= lo) continue
      this.rolls[k].set(outputs[k].subarray(lo * KEYS, hi * KEYS), (offset + lo) * KEYS)
    }
  }

  finish(): Rolls {
    const [onset, offset, frame, velocity] = this.rolls
    return { frames: this.frames, onset, offset, frame, velocity }
  }
}

export interface PostProcessOptions {
  onsetThreshold: number
  offsetThreshold: number
  frameThreshold: number
}

export const DEFAULT_POST: PostProcessOptions = { onsetThreshold: 0.3, offsetThreshold: 0.3, frameThreshold: 0.1 }

/** Reference `get_binarized_output_from_regression` for one key column. */
function binarize(roll: Float32Array, frames: number, key: number, threshold: number, neighbour: number) {
  const binary = new Uint8Array(frames)
  const shift = new Float32Array(frames)
  const x = (n: number) => roll[n * KEYS + key]
  for (let n = neighbour; n < frames - neighbour; n++) {
    const v = x(n)
    if (v <= threshold) continue
    let mono = true
    for (let i = 0; i < neighbour && mono; i++) {
      if (x(n - i) < x(n - i - 1)) mono = false
      if (x(n + i) < x(n + i + 1)) mono = false
    }
    if (!mono) continue
    binary[n] = 1
    // sub-frame peak position (Section III-D of the paper)
    const a = x(n - 1)
    const b = x(n + 1)
    shift[n] = a > b ? (b - a) / (v - b) / 2 : (b - a) / (v - a) / 2
  }
  return { binary, shift }
}

/** Reference `note_detection_with_onset_offset_regress` for one key. */
function detectKey(
  frames: number,
  key: number,
  r: Rolls,
  onset: { binary: Uint8Array; shift: Float32Array },
  offset: { binary: Uint8Array; shift: Float32Array },
  frameThreshold: number,
): RawNote[] {
  const out: RawNote[] = []
  let bgn: number | null = null
  let frameDisappear: number | null = null
  let offsetOccur: number | null = null
  const emit = (b: number, fin: number, offShift: number) => {
    const vel = r.velocity[b * KEYS + key]
    out.push({
      pitch: key + BEGIN_NOTE,
      start: (b + onset.shift[b]) / FPS,
      end: (fin + offShift) / FPS,
      velocity: Math.max(1, Math.min(127, Math.round(vel * 128))),
    })
  }
  for (let i = 0; i < frames; i++) {
    if (onset.binary[i]) {
      if (bgn !== null) {
        // consecutive onsets: close the previous note just before this one
        emit(bgn, Math.max(i - 1, 0), 0)
        frameDisappear = null
        offsetOccur = null
      }
      bgn = i
    }
    if (bgn !== null && i > bgn) {
      if (r.frame[i * KEYS + key] <= frameThreshold && frameDisappear === null) frameDisappear = i
      if (offset.binary[i] && offsetOccur === null) offsetOccur = i
      if (frameDisappear !== null) {
        const fin = offsetOccur !== null && offsetOccur - bgn > frameDisappear - offsetOccur ? offsetOccur : frameDisappear
        emit(bgn, fin, offset.shift[fin])
        bgn = frameDisappear = offsetOccur = null
      }
      if (bgn !== null && (i - bgn >= 600 || i === frames - 1)) {
        emit(bgn, i, offset.shift[i])
        bgn = frameDisappear = offsetOccur = null
      }
    }
  }
  return out
}

/** Turns model rolls into notes. Same thresholds as the reference inference code. */
export function rollsToNotes(r: Rolls, opts: PostProcessOptions = DEFAULT_POST): RawNote[] {
  const notes: RawNote[] = []
  for (let k = 0; k < KEYS; k++) {
    const on = binarize(r.onset, r.frames, k, opts.onsetThreshold, 2)
    const off = binarize(r.offset, r.frames, k, opts.offsetThreshold, 4)
    for (const n of detectKey(r.frames, k, r, on, off, opts.frameThreshold)) {
      if (n.end > n.start) notes.push(n)
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return notes
}

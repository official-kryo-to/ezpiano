/** Node-only helpers for tests and the benchmark: WAV reading, resampling and an ORT runner. */
import { readFileSync } from 'node:fs'
import * as ort from 'onnxruntime-web'
import { ROLL_NAMES, SEGMENT_SAMPLES } from '../../src/engine/kong'
import type { SegmentRunner } from '../../src/engine/transcribe'

export function readWav(path: string): { data: Float32Array; rate: number } {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file')
  let off = 12
  let fmt = { format: 1, channels: 1, rate: 44100, bits: 16 }
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      const bytes = fmt.bits / 8
      const frames = Math.floor(size / (bytes * fmt.channels))
      const out = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let s = 0
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bytes
          s += fmt.format === 3 ? buf.readFloatLE(p) : fmt.bits === 16 ? buf.readInt16LE(p) / 32768 : buf.readInt32LE(p) / 2147483648
        }
        out[i] = s / fmt.channels
      }
      return { data: out, rate: fmt.rate }
    }
    off = body + size + (size % 2)
  }
  throw new Error('no data chunk')
}

/** Windowed-sinc resampler (Blackman, 32 zero crossings): plenty for model input. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  const ratio = to / from
  const n = Math.floor(x.length * ratio)
  const out = new Float32Array(n)
  const cutoff = Math.min(1, ratio) * 0.97
  const Z = 32
  const half = Math.ceil(Z / cutoff)
  for (let i = 0; i < n; i++) {
    const center = i / ratio
    const c0 = Math.floor(center)
    let acc = 0
    let norm = 0
    for (let j = c0 - half + 1; j <= c0 + half; j++) {
      if (j < 0 || j >= x.length) continue
      const t = (j - center) * cutoff
      const w = 0.42 + 0.5 * Math.cos((Math.PI * (j - center)) / half) + 0.08 * Math.cos((2 * Math.PI * (j - center)) / half)
      const s = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
      acc += x[j] * s * w
      norm += s * w
    }
    out[i] = norm ? acc / norm : 0
  }
  return out
}

export async function nodeRunner(modelPath: string, threads = 4): Promise<SegmentRunner> {
  ort.env.wasm.numThreads = threads
  const session = await ort.InferenceSession.create(readFileSync(modelPath), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  return {
    async run(segment) {
      const out = await session.run({ audio: new ort.Tensor('float32', segment, [1, SEGMENT_SAMPLES]) })
      return ROLL_NAMES.map((k) => out[k].data as Float32Array)
    },
  }
}

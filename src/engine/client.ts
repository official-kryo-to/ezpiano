/**
 * Main-thread side of a conversion: decode -> worker (model) -> arrange -> MIDI.
 * Reports named stages with a progress fraction and a time estimate.
 */
import { arrange } from './arrange'
import { BASIC_PITCH_RATE } from './basicPitch'
import { cleanNotes } from './cleanup'
import { decodeAudio } from './decode'
import { SAMPLE_RATE } from './kong'
import { buildMidi } from './midi'
import { analyzeTempo } from './tempo'
import { unpackNotes } from './transcribe'
import type { ArrangeSettings, Arrangement, BeatGrid, EngineKind, RawNote } from './types'
import type { WorkerMessage, WorkerRequest } from './worker'

export type StageId = 'decode' | 'model' | 'transcribe' | 'cleanup' | 'tempo' | 'hands' | 'midi'

export const STAGES: { id: StageId; label: string }[] = [
  { id: 'decode', label: 'Decoding audio' },
  { id: 'model', label: 'Loading the piano model' },
  { id: 'transcribe', label: 'Listening for notes' },
  { id: 'cleanup', label: 'Cleaning up' },
  { id: 'tempo', label: 'Finding the beat' },
  { id: 'hands', label: 'Arranging both hands' },
  { id: 'midi', label: 'Writing the MIDI file' },
]

export interface Progress {
  stage: StageId
  /** 0..1 within the stage */
  fraction: number
  detail?: string
  /** seconds left, when we can tell */
  eta?: number
  backend?: string
}

const asset = (path: string) => new URL(import.meta.env.BASE_URL + path, location.href).href

export interface Transcription {
  raw: RawNote[]
  duration: number
  backend: string
}

/** Decode + run the model in a worker. Abort with the signal (terminates the worker). */
export function transcribeFile(
  file: Blob,
  engine: EngineKind,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<Transcription> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null
    let backend = ''
    const abort = () => {
      worker?.terminate()
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })

    ;(async () => {
      onProgress({ stage: 'decode', fraction: 0 })
      const rate = engine === 'piano' ? SAMPLE_RATE : BASIC_PITCH_RATE
      const { audio, duration } = await decodeAudio(file, rate)
      if (signal?.aborted) return
      if (duration < 0.5) throw new Error('This file is too short to transcribe.')
      onProgress({ stage: 'decode', fraction: 1 })

      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      let started = 0
      let firstDone = 0
      worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const m = ev.data
        if (m.type === 'model') {
          const mb = (x: number) => (x / 1e6).toFixed(1)
          onProgress({ stage: 'model', fraction: m.total ? m.loaded / m.total : 0, detail: `${mb(m.loaded)} of ${mb(m.total)} MB` })
        } else if (m.type === 'backend') {
          backend = m.backend
        } else if (m.type === 'progress') {
          const now = performance.now()
          if (m.done === 0) started = now
          if (m.done === 1) firstDone = now
          let eta: number | undefined
          // the first window includes warm-up, so estimate from the ones after it
          if (m.done >= 2 && firstDone) eta = (((now - firstDone) / (m.done - 1)) * (m.total - m.done)) / 1000
          else if (m.done === 1 && started) eta = (((now - started) / 1) * (m.total - 1)) / 1000
          const detail = engine === 'piano' ? `Part ${Math.min(m.done + 1, m.total)} of ${m.total}` : undefined
          onProgress({ stage: 'transcribe', fraction: m.total ? m.done / m.total : 0, eta, detail, backend })
        } else if (m.type === 'done') {
          worker?.terminate()
          resolve({ raw: unpackNotes(m.notes), duration, backend })
        } else if (m.type === 'error') {
          worker?.terminate()
          reject(new Error(m.message))
        }
      }
      worker.onerror = (e) => {
        worker?.terminate()
        reject(new Error(e.message || 'The converter stopped unexpectedly.'))
      }
      const req: WorkerRequest =
        engine === 'piano'
          ? { type: 'piano', audio, modelUrl: asset('models/kong-piano-int8.onnx') }
          : { type: 'basic-pitch', audio, modelUrl: asset('models/basic-pitch/model.json') }
      onProgress({ stage: engine === 'piano' ? 'model' : 'transcribe', fraction: 0 })
      worker.postMessage(req, [audio.buffer])
    })().catch((e) => {
      worker?.terminate()
      reject(e)
    })
  })
}

export interface Result {
  arrangement: Arrangement
  midi: Uint8Array
  clean: RawNote[]
  grid: BeatGrid
}

/** Everything after the model. Fast (milliseconds), so it can re-run when settings change. */
export type Channels = { rh: number; lh: number }

export function buildResult(
  raw: RawNote[],
  settings: ArrangeSettings,
  title: string,
  cached?: { clean: RawNote[]; grid: BeatGrid },
  channels?: Channels,
): Result {
  const clean = cached?.clean ?? cleanNotes(raw)
  const grid = cached?.grid ?? analyzeTempo(clean)
  const arrangement = arrange(clean, grid, settings)
  return { arrangement, midi: buildMidi(arrangement, title, channels), clean, grid }
}

/** Same as buildResult, but walks the UI through the named stages. */
export async function buildResultWithStages(
  raw: RawNote[],
  settings: ArrangeSettings,
  title: string,
  onProgress: (p: Progress) => void,
  channels?: Channels,
): Promise<Result> {
  const tick = () => new Promise((r) => setTimeout(r, 120))
  onProgress({ stage: 'cleanup', fraction: 0 })
  await tick()
  const clean = cleanNotes(raw)
  onProgress({ stage: 'tempo', fraction: 0 })
  await tick()
  const grid = analyzeTempo(clean)
  onProgress({ stage: 'hands', fraction: 0, detail: `${Math.round(grid.bpm)} BPM` })
  await tick()
  const arrangement = arrange(clean, grid, settings)
  onProgress({ stage: 'midi', fraction: 0 })
  await tick()
  return { arrangement, midi: buildMidi(arrangement, title, channels), clean, grid }
}

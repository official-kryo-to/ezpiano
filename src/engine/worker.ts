/// <reference lib="webworker" />
/**
 * Transcription worker. Runs the piano model with onnxruntime-web (WebGPU when the device has
 * one, WASM otherwise) or Basic Pitch, and reports progress. Keeps the UI thread free.
 */
import type { InferenceSession, Tensor } from 'onnxruntime-web'
import { transcribeBasicPitch } from './basicPitch'
import { ROLL_NAMES, SEGMENT_SAMPLES } from './kong'
import { packNotes, transcribePiano, type SegmentRunner } from './transcribe'

export type WorkerRequest =
  | { type: 'warmup'; modelUrl: string }
  | { type: 'piano'; audio: Float32Array; modelUrl: string; hopSeconds?: number }
  | { type: 'basic-pitch'; audio: Float32Array; modelUrl: string }

export type WorkerMessage =
  | { type: 'model'; loaded: number; total: number }
  | { type: 'backend'; backend: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; notes: Float32Array }
  | { type: 'error'; message: string }

const post = (m: WorkerMessage, transfer: Transferable[] = []) => {
  if (m.type === 'backend') lastBackend = m.backend
  ;(self as unknown as Worker).postMessage(m, transfer)
}

type Ort = typeof import('onnxruntime-web')

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

/** Fetches the model with byte-level progress. The service worker caches it after the first time. */
async function fetchModel(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Could not load the piano model (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let lastPost = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (loaded - lastPost > 512 * 1024) {
      lastPost = loaded
      post({ type: 'model', loaded, total })
    }
  }
  const out = new Uint8Array(loaded)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  post({ type: 'model', loaded, total: total || loaded })
  return out
}

async function pianoRunner(modelUrl: string): Promise<SegmentRunner> {
  const gpu = await hasWebGpu()
  const ort: Ort = gpu ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm')
  // threads need cross-origin isolation (our service worker provides it after the first load)
  // leave a core or two for the page; more than 8 threads stops helping
  const cores = navigator.hardwareConcurrency || 2
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, cores > 4 ? cores - 2 : cores - 1)) : 1
  const bytes = await fetchModel(modelUrl)

  const create = (eps: string[]) =>
    ort.InferenceSession.create(bytes, { executionProviders: eps, graphOptimizationLevel: 'all' })
  let session: InferenceSession
  let backend = gpu ? 'webgpu' : 'wasm'
  try {
    session = await create(gpu ? ['webgpu', 'wasm'] : ['wasm'])
  } catch (e) {
    if (!gpu) throw e
    session = await create(['wasm'])
    backend = 'wasm'
  }
  post({ type: 'backend', backend: `${backend}${ort.env.wasm.numThreads > 1 ? ` x${ort.env.wasm.numThreads}` : ''}` })

  const runOnce = async (segment: Float32Array) => {
    const out = await session.run({ audio: new ort.Tensor('float32', segment, [1, SEGMENT_SAMPLES]) })
    return ROLL_NAMES.map((n) => (out[n] as Tensor).data as Float32Array)
  }
  return {
    async run(segment) {
      try {
        return await runOnce(segment)
      } catch (e) {
        if (backend !== 'webgpu') throw e
        // some GPUs fail at run time: fall back to CPU and carry on
        session = await create(['wasm'])
        backend = 'wasm'
        post({ type: 'backend', backend })
        return runOnce(segment)
      }
    },
  }
}

// anything that escapes (e.g. inside a library's timer) must still reach the UI
self.addEventListener('error', (e) => post({ type: 'error', message: e.message || 'The converter crashed.' }))
self.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String((e as PromiseRejectionEvent).reason?.message ?? e) }))

// The page warms the worker up while you pick settings: runtime + model are ready on Convert.
let warm: Promise<SegmentRunner> | null = null
let lastBackend = ''
const getRunner = (modelUrl: string) => (warm ??= pianoRunner(modelUrl))

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    let notes
    if (req.type === 'warmup') {
      await getRunner(req.modelUrl).catch(() => {
        warm = null // try again (and report the error) on Convert
      })
      return
    }
    if (req.type === 'piano') {
      const runner = await getRunner(req.modelUrl)
      if (lastBackend) post({ type: 'backend', backend: lastBackend })
      notes = await transcribePiano(req.audio, runner, {
        hopSeconds: req.hopSeconds,
        onProgress: (done, total) => post({ type: 'progress', done, total }),
      })
    } else {
      post({ type: 'backend', backend: 'basic-pitch' })
      notes = await transcribeBasicPitch(req.audio, req.modelUrl, (p) =>
        post({ type: 'progress', done: Math.round(p * 1000), total: 1000 }),
      )
    }
    const packed = packNotes(notes)
    post({ type: 'done', notes: packed }, [packed.buffer])
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

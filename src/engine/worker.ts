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
  | { type: 'warmup'; modelUrl: string; gpu?: GpuMode }
  | { type: 'piano'; audio: Float32Array; modelUrl: string; hopSeconds?: number; gpu?: GpuMode }
  | { type: 'basic-pitch'; audio: Float32Array; modelUrl: string }

export type WorkerMessage =
  | { type: 'model'; loaded: number; total: number }
  | { type: 'backend'; backend: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'partial'; notes: Float32Array }
  | { type: 'done'; notes: Float32Array }
  | { type: 'error'; message: string }

const post = (m: WorkerMessage, transfer: Transferable[] = []) => {
  if (m.type === 'backend') lastBackend = m.backend
  ;(self as unknown as Worker).postMessage(m, transfer)
}

type Ort = typeof import('onnxruntime-web')

/** auto: real GPUs only, raced against the CPU. any: also software adapters (testing). force: GPU, no race. */
export type GpuMode = 'auto' | 'any' | 'force' | 'off'

/** A real GPU adapter is available. Software adapters (SwiftShader, llvmpipe) are much slower than WASM. */
async function hasWebGpu(mode: GpuMode): Promise<boolean> {
  if (mode === 'off') return false
  type Adapter = { isFallbackAdapter?: boolean; info?: { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean } }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu
  if (!gpu) return false
  try {
    const adapter = (await gpu.requestAdapter()) as Adapter | null
    if (!adapter) return false
    if (mode === 'force' || mode === 'any') return true
    const info = adapter.info ?? {}
    const software = /swiftshader|llvmpipe|software|basic render/i.test(`${info.vendor} ${info.architecture} ${info.description}`)
    return !(adapter.isFallbackAdapter || info.isFallbackAdapter || software)
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

/** A GPU window faster than this is kept without comparing against the CPU. */
const GPU_FAST_SECONDS = 3

async function pianoRunner(modelUrl: string, gpuMode: GpuMode = 'auto'): Promise<SegmentRunner> {
  const gpu = await hasWebGpu(gpuMode)
  const ort: Ort = gpu ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm')
  // threads need cross-origin isolation (our service worker provides it after the first load)
  // leave a core or two for the page; more than 8 threads stops helping
  const cores = navigator.hardwareConcurrency || 2
  const threads = self.crossOriginIsolated ? Math.max(1, Math.min(8, cores > 4 ? cores - 2 : cores - 1)) : 1
  ort.env.wasm.numThreads = threads
  const bytes = await fetchModel(modelUrl)
  const label = (b: 'webgpu' | 'wasm') => (b === 'webgpu' ? 'webgpu' : `wasm${threads > 1 ? ` x${threads}` : ''}`)

  const create = (eps: string[]) =>
    ort.InferenceSession.create(bytes, { executionProviders: eps, graphOptimizationLevel: 'all' })
  let gpuSession: InferenceSession | null = null
  let cpuSession: InferenceSession | null = null
  let active: 'webgpu' | 'wasm' = gpu ? 'webgpu' : 'wasm'
  if (gpu) {
    try {
      gpuSession = await create(['webgpu', 'wasm'])
    } catch {
      active = 'wasm'
    }
  }
  if (active === 'wasm') cpuSession = await create(['wasm'])
  post({ type: 'backend', backend: label(active) })

  const runOn = async (session: InferenceSession, segment: Float32Array) => {
    const out = await session.run({ audio: new ort.Tensor('float32', segment, [1, SEGMENT_SAMPLES]) })
    return ROLL_NAMES.map((n) => (out[n] as Tensor).data as Float32Array)
  }
  const useCpu = async () => {
    cpuSession ??= await create(['wasm'])
    active = 'wasm'
    post({ type: 'backend', backend: label('wasm') })
  }

  // The GPU is not always the faster choice (integrated or busy GPUs). On the second window, when
  // its shaders are compiled, a slow GPU is raced against the CPU on the same audio; the faster
  // one does the rest. The same race checks that the GPU's answer matches the CPU's.
  let gpuRuns = 0
  let decided = gpuMode === 'force'
  return {
    async run(segment) {
      if (active === 'wasm') return runOn(cpuSession!, segment)
      let out: Float32Array[]
      const t0 = performance.now()
      try {
        out = await runOn(gpuSession!, segment)
      } catch {
        // some GPUs fail at run time: fall back to CPU and carry on
        await useCpu()
        return runOn(cpuSession!, segment)
      }
      const gpuSeconds = (performance.now() - t0) / 1000
      gpuRuns++
      if (!decided && gpuSeconds <= GPU_FAST_SECONDS) decided = true
      if (!decided && gpuRuns >= 2) {
        decided = true
        cpuSession ??= await create(['wasm'])
        const t1 = performance.now()
        const cpuOut = await runOn(cpuSession, segment)
        const cpuSeconds = (performance.now() - t1) / 1000
        let diff = 0
        for (let i = 0; i < cpuOut[0].length; i += 7) diff = Math.max(diff, Math.abs(cpuOut[0][i] - out[0][i]))
        if (diff > 0.05 || cpuSeconds < gpuSeconds) {
          await useCpu()
          return cpuOut
        }
      }
      return out
    },
  }
}

// anything that escapes (e.g. inside a library's timer) must still reach the UI
self.addEventListener('error', (e) => post({ type: 'error', message: e.message || 'The converter crashed.' }))
self.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String((e as PromiseRejectionEvent).reason?.message ?? e) }))

// The page warms the worker up while you pick settings: runtime + model are ready on Convert.
let warm: Promise<SegmentRunner> | null = null
let lastBackend = ''
const getRunner = (modelUrl: string, gpu?: GpuMode) => (warm ??= pianoRunner(modelUrl, gpu))

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    let notes
    if (req.type === 'warmup') {
      await getRunner(req.modelUrl, req.gpu).catch(() => {
        warm = null // try again (and report the error) on Convert
      })
      return
    }
    if (req.type === 'piano') {
      const runner = await getRunner(req.modelUrl, req.gpu)
      if (lastBackend) post({ type: 'backend', backend: lastBackend })
      notes = await transcribePiano(req.audio, runner, {
        hopSeconds: req.hopSeconds,
        onProgress: (done, total) => post({ type: 'progress', done, total }),
        onPartial: (part) => {
          const packed = packNotes(part)
          post({ type: 'partial', notes: packed }, [packed.buffer])
        },
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

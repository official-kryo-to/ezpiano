/**
 * Benchmark: piano model (as shipped) vs Basic Pitch on WAV clips with reference notes.
 *
 *   npx tsx scripts/benchmark.ts <clips-dir> <out-dir> [fp32-model.onnx]
 *
 * <clips-dir> holds pairs: name.wav + name.notes.json ([{pitch,start,end,end_pedal}]).
 * Writes <out-dir>/<system>/<name>.json with predicted notes and <out-dir>/timing.json.
 * Score with: python scripts/benchmark_eval.py <clips-dir> <out-dir>
 * Uses onnxruntime-web (WASM, 4 threads) and Basic Pitch's tfjs CPU backend, i.e. the same code
 * paths the browser uses, minus WebGPU.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as tf from '@tensorflow/tfjs'
import { BASIC_PITCH_RATE, transcribeBasicPitch } from '../src/engine/basicPitch'
import { transcribePiano } from '../src/engine/transcribe'
import { nodeRunner, readWav, resample } from '../tests/helpers/node'

const [clipsDir, outDir, fp32Path] = process.argv.slice(2)
const clips = readdirSync(clipsDir).filter((f) => f.endsWith('.wav')).map((f) => f.replace(/\.wav$/, ''))

function loadBasicPitchModel() {
  const dir = 'node_modules/@spotify/basic-pitch/model'
  const json = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'))
  const bin = readFileSync(join(dir, json.weightsManifest[0].paths[0]))
  return tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest[0].weights,
      weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    }),
  )
}

const systems: { name: string; run: (audio: Float32Array, rate: number) => Promise<unknown[]> }[] = [
  {
    name: 'kong-int8-hop7.5',
    run: async (a, r) => transcribePiano(resample(a, r, 16000), await int8, { hopSeconds: 7.5 }),
  },
  {
    name: 'kong-int8-hop5',
    run: async (a, r) => transcribePiano(resample(a, r, 16000), await int8, { hopSeconds: 5 }),
  },
  ...(fp32Path
    ? [{ name: 'kong-fp32-hop5', run: async (a: Float32Array, r: number) => transcribePiano(resample(a, r, 16000), await nodeRunner(fp32Path), { hopSeconds: 5 }) }]
    : []),
  {
    name: 'basic-pitch',
    run: async (a, r) => transcribeBasicPitch(resample(a, r, BASIC_PITCH_RATE), loadBasicPitchModel()),
  },
]
const int8 = nodeRunner('public/models/kong-piano-int8.onnx')

const timing: Record<string, Record<string, number>> = {}
for (const sys of systems) {
  mkdirSync(join(outDir, sys.name), { recursive: true })
  timing[sys.name] = {}
  for (const clip of clips) {
    const { data, rate } = readWav(join(clipsDir, clip + '.wav'))
    const t = performance.now()
    const notes = await sys.run(data, rate)
    timing[sys.name][clip] = (performance.now() - t) / 1000
    writeFileSync(join(outDir, sys.name, clip + '.json'), JSON.stringify(notes))
    console.log(sys.name, clip, notes.length, 'notes', timing[sys.name][clip].toFixed(1), 's')
  }
}
writeFileSync(join(outDir, 'timing.json'), JSON.stringify(timing, null, 1))

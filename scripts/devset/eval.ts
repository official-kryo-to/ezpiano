/**
 * Score the whole pipeline on a rendered dev set.
 *
 *   npx tsx scripts/devset/eval.ts <gt-dir> <wav-dir> [--cache dir]
 *
 * Metrics per clip and on average:
 *   note F1 (onset within 50 ms, exact pitch), beat F (70 ms), downbeat F, melody F1 (right hand
 *   vs the MELODY track, onset within 100 ms), chord-root accuracy (left-hand chords vs annotations).
 * Model outputs are cached so changes to post-processing re-score in seconds.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arrange } from '../../src/engine/arrange'
import { cleanNotes } from '../../src/engine/cleanup'
import { RollStitcher, rollsToNotes, segmentStarts, sliceSegment, type Rolls } from '../../src/engine/kong'
import { prepareAudio } from '../../src/engine/preprocess'
import { analyzeTempo } from '../../src/engine/tempo'
import { DEFAULT_HOP_SECONDS } from '../../src/engine/transcribe'
import type { RawNote } from '../../src/engine/types'
import { nodeRunner, readWav, resample } from '../../tests/helpers/node'

const [gtDir, wavDir] = process.argv.slice(2)
const ci = process.argv.indexOf('--cache')
const cacheDir = ci > 0 ? process.argv[ci + 1] : join(wavDir, '.cache')
mkdirSync(cacheDir, { recursive: true })
const runner = nodeRunner('public/models/kong-piano-int8.onnx')

async function rolls(name: string, audio: Float32Array): Promise<Rolls> {
  const hop = DEFAULT_HOP_SECONDS
  const starts = segmentStarts(audio.length, hop)
  const st = new RollStitcher(starts.length, audio.length, hop)
  const file = join(cacheDir, name + '.bin')
  const n = st.frames * 88
  if (existsSync(file)) {
    const b = readFileSync(file)
    const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
    return { frames: st.frames, onset: f.slice(0, n), offset: f.slice(n, 2 * n), frame: f.slice(2 * n, 3 * n), velocity: f.slice(3 * n) }
  }
  for (const s of starts) st.push(await (await runner).run(sliceSegment(audio, s)))
  const r = st.finish()
  const all = new Float32Array(4 * n)
  ;[r.onset, r.offset, r.frame, r.velocity].forEach((x, i) => all.set(x, i * n))
  writeFileSync(file, Buffer.from(all.buffer))
  return r
}

function noteF(ref: RawNote[], est: RawNote[], tol: number) {
  const used = new Uint8Array(est.length)
  const e = est.map((x, i) => ({ x, i })).sort((a, b) => a.x.start - b.x.start)
  let hit = 0
  for (const r of ref)
    for (const { x, i } of e) {
      if (x.start > r.start + tol) break
      if (used[i] || x.start < r.start - tol || x.pitch !== r.pitch) continue
      used[i] = 1
      hit++
      break
    }
  const p = est.length ? hit / est.length : 0
  const rc = ref.length ? hit / ref.length : 0
  return p + rc ? (2 * p * rc) / (p + rc) : 0
}

function beatF(ref: number[], est: number[], tol = 0.07) {
  const lo = Math.min(...ref) - 0.2
  const hi = Math.max(...ref) + 0.2
  const e = est.filter((b) => b >= lo && b <= hi)
  const used = new Set<number>()
  let hit = 0
  for (const r of ref) {
    const i = e.findIndex((b, k) => !used.has(k) && Math.abs(b - r) <= tol)
    if (i >= 0) {
      used.add(i)
      hit++
    }
  }
  const p = e.length ? hit / e.length : 0
  const rc = ref.length ? hit / ref.length : 0
  return p + rc ? (2 * p * rc) / (p + rc) : 0
}

const PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
const sums: Record<string, number[]> = {}
const add = (k: string, v: number) => (sums[k] ??= []).push(v)

for (const f of readdirSync(gtDir).filter((x) => x.endsWith('.json')).sort()) {
  const name = f.replace('.json', '')
  const wav = join(wavDir, name + '.wav')
  if (!existsSync(wav)) continue
  const gt = JSON.parse(readFileSync(join(gtDir, f), 'utf8'))
  const { data, rate } = readWav(wav)
  const notes = cleanNotes(rollsToNotes(await rolls(name, prepareAudio(resample(data, rate, 16000)))))
  const grid = analyzeTempo(notes)
  const origin = grid.beats[0]
  const scores: Record<string, number> = { note: noteF(gt.notes, notes, 0.05) }
  if (gt.beats?.length) {
    scores.beat = beatF(gt.beats, grid.beats)
    scores.downbeat = beatF(gt.downbeats, grid.beats.filter((_, i) => i % 4 === 0))
    const mel = arrange(notes, grid, { output: 'melody', difficulty: 'original', transpose: 0, autoTranspose: false, quantize: false })
    scores.melody = noteF(
      gt.notes.filter((n: { track: string }) => n.track === 'MELODY'),
      mel.notes.map((n) => ({ ...n, start: n.start + origin })),
      0.1,
    )
    const ch = arrange(notes, grid, { output: 'chords', difficulty: 'medium', transpose: 0, autoTranspose: false, quantize: false })
    const lh = ch.notes.filter((n) => n.hand === 'L')
    let tot = 0
    let ok = 0
    for (const [s, e, label] of gt.chords as [number, number, string][]) {
      const root = PC[label.split(':')[0]]
      if (root == null) continue
      for (let x = Math.max(0, s) + 0.05; x < e; x += 0.25) {
        tot++
        const on = lh.filter((n) => n.start + origin <= x && n.end + origin > x)
        if (on.length && on.reduce((m, n) => (n.pitch < m.pitch ? n : m)).pitch % 12 === root) ok++
      }
    }
    scores.chordRoot = tot ? ok / tot : 0
  }
  for (const [k, v] of Object.entries(scores)) add(k, v)
  console.log(name.padEnd(12), Object.entries(scores).map(([k, v]) => `${k} ${v.toFixed(3)}`).join('  '))
}
console.log('MEAN        ', Object.entries(sums).map(([k, v]) => `${k} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)}`).join('  '))

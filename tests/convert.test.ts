/**
 * End-to-end conversion of a short bundled piano clip with the real model (onnxruntime-web, WASM),
 * then checks the MIDI file the EZ-220 will get.
 */
import { Midi } from '@tonejs/midi'
import { beforeAll, describe, expect, it } from 'vitest'
import { arrange } from '../src/engine/arrange'
import { cleanNotes } from '../src/engine/cleanup'
import { buildMidi, midiFileName } from '../src/engine/midi'
import { analyzeTempo } from '../src/engine/tempo'
import { transcribePiano } from '../src/engine/transcribe'
import { MAX_POLY, type ArrangeSettings, type BeatGrid, type Difficulty, type OutputMode, type RawNote } from '../src/engine/types'
import { nodeRunner, readWav, resample } from './helpers/node'

const OUTPUTS: OutputMode[] = ['melody', 'chords', 'full']
const LEVELS: Difficulty[] = ['easy', 'medium', 'original']

let raw: RawNote[] = []
let clean: RawNote[] = []
let grid: BeatGrid

/** Max notes sounding at once, from the parsed MIDI track. */
function maxPolyphony(notes: { ticks: number; durationTicks: number }[]) {
  let max = 0
  for (const n of notes) {
    const at = notes.filter((m) => m.ticks <= n.ticks && m.ticks + m.durationTicks > n.ticks).length
    max = Math.max(max, at)
  }
  return max
}

beforeAll(async () => {
  const { data, rate } = readWav('tests/fixtures/ode-to-joy-8s.wav')
  const runner = await nodeRunner('public/models/kong-piano-int8.onnx')
  raw = await transcribePiano(resample(data, rate, 16000), runner)
  clean = cleanNotes(raw)
  grid = analyzeTempo(clean)
})

describe('transcription of the bundled clip', () => {
  it('finds the notes that were played', async () => {
    const ref: RawNote[] = (await import('./fixtures/ode-to-joy-8s.notes.json')).default
    const used = new Set<number>()
    let hits = 0
    for (const r of ref) {
      const i = raw.findIndex((n, k) => !used.has(k) && n.pitch === r.pitch && Math.abs(n.start - r.start) < 0.05)
      if (i >= 0) {
        hits++
        used.add(i)
      }
    }
    expect(hits / ref.length).toBeGreaterThan(0.9) // recall
  })

  it('detects the tempo (rendered at 100 BPM)', () => {
    expect(grid.bpm).toBeGreaterThan(95)
    expect(grid.bpm).toBeLessThan(105)
  })
})

describe('arrangement quality', () => {
  it('the right hand plays the actual tune', async () => {
    const ref: RawNote[] = (await import('./fixtures/ode-to-joy-8s.notes.json')).default
    const tune = ref.filter((n) => n.pitch >= 60) // the right-hand line of the rendered clip
    const arr = arrange(clean, grid, { output: 'melody', difficulty: 'original', transpose: 0, autoTranspose: false, quantize: false })
    const origin = grid.beats[0]
    const rh = arr.notes.filter((n) => n.hand === 'R')
    const used = new Set<number>()
    let hits = 0
    for (const r of tune) {
      const i = rh.findIndex((n, k) => !used.has(k) && n.pitch === r.pitch && Math.abs(n.start + origin - r.start) < 0.08)
      if (i >= 0) {
        used.add(i)
        hits++
      }
    }
    const precision = hits / rh.length
    const recall = hits / tune.length
    expect(recall).toBeGreaterThan(0.85)
    expect(precision).toBeGreaterThan(0.85)
  })

  it('the first downbeat is the first note (the clip starts on beat 1)', () => {
    expect(Math.abs(grid.beats[0] - clean[0].start)).toBeLessThan(0.06)
  })
})

describe.each(OUTPUTS)('MIDI output: %s', (output) => {
  it.each(LEVELS)('%s difficulty', (difficulty) => {
    const settings: ArrangeSettings = { output, difficulty, transpose: 0, autoTranspose: false, quantize: true }
    const arr = arrange(clean, grid, settings)
    const bytes = buildMidi(arr, 'Ode to Joy')
    // type 1 file
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd')
    expect((bytes[8] << 8) | bytes[9]).toBe(1)

    const midi = new Midi(bytes)
    expect(midi.tracks.map((t) => t.name)).toEqual(['Right Hand', 'Left Hand'])
    const [rh, lh] = midi.tracks
    expect(rh.notes.length).toBeGreaterThan(5)
    expect(rh.channel).toBe(0) // MIDI channel 1: the EZ-220 only lights keys for channel 1
    expect(rh.instrument.number).toBe(0)
    if (lh.notes.length) {
      expect(lh.channel).toBe(1)
      expect(lh.instrument.number).toBe(0)
    }
    if (output === 'melody') expect(lh.notes.length).toBe(0)
    else expect(lh.notes.length).toBeGreaterThan(0)

    for (const t of midi.tracks) for (const n of t.notes) {
      expect(n.midi).toBeGreaterThanOrEqual(36)
      expect(n.midi).toBeLessThanOrEqual(96)
    }
    const rhCap = output === 'full' ? MAX_POLY[difficulty].R : 1
    expect(maxPolyphony(rh.notes)).toBeLessThanOrEqual(rhCap)
    expect(maxPolyphony(lh.notes)).toBeLessThanOrEqual(MAX_POLY[difficulty].L)
    expect(maxPolyphony(lh.notes)).toBeLessThanOrEqual(4)

    expect(midi.header.tempos[0].bpm).toBeCloseTo(grid.bpm, 1)
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([4, 4])
    // quantized: every note starts on the 1/8 (easy) or 1/16 grid
    const step = midi.header.ppq / (difficulty === 'easy' ? 2 : 4)
    for (const t of midi.tracks) for (const n of t.notes) expect(n.ticks % step).toBe(0)
  })
})

describe('range and transpose', () => {
  it('keeps every note on the 61 keys after a big transpose, shifting by octaves', () => {
    for (const transpose of [-12, 12]) {
      const arr = arrange(clean, grid, { output: 'full', difficulty: 'original', transpose, autoTranspose: false, quantize: false })
      expect(arr.notes.length).toBeGreaterThan(10)
      for (const n of arr.notes) {
        expect(n.pitch).toBeGreaterThanOrEqual(36)
        expect(n.pitch).toBeLessThanOrEqual(96)
      }
    }
  })

  it('never drops notes that are out of range', () => {
    const notes: RawNote[] = [
      { pitch: 21, start: 0, end: 0.5, velocity: 80 },
      { pitch: 108, start: 1, end: 1.5, velocity: 80 },
    ]
    const g: BeatGrid = { bpm: 120, beats: [0, 0.5, 1, 1.5, 2, 2.5], steady: true }
    const arr = arrange(notes, g, { output: 'full', difficulty: 'original', transpose: 0, autoTranspose: false, quantize: true })
    expect(arr.notes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([45, 96])
  })

  it('auto-transposes to C major / A minor', () => {
    const arr = arrange(clean, grid, { output: 'melody', difficulty: 'easy', transpose: 0, autoTranspose: true, quantize: true })
    expect(arr.key).toEqual({ tonic: 0, mode: 'major' })
    expect(arr.transpose).toBe(0)
  })

  it('names the file for the EZ-220', () => {
    expect(midiFileName('My Song (cover).mp3')).toBe('My Song (cover)_ez220.mid')
  })
})

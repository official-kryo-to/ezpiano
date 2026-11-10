import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { arrange, detectFeel, gridStep } from '../src/engine/arrange'
import { buildMidi } from '../src/engine/midi'
import { adjustGrid } from '../src/engine/tempo'
import type { BeatGrid, RawNote } from '../src/engine/types'

const grid = (bpm: number, n = 33): BeatGrid => ({ bpm, beats: Array.from({ length: n }, (_, i) => (i * 60) / bpm), steady: true })
const note = (start: number, pitch = 64, velocity = 80): RawNote => ({ pitch, start, end: start + 0.2, velocity })

describe('quantize grid follows the tempo', () => {
  it('Easy uses eighths at normal tempo and sixteenths when the beat is slow', () => {
    expect(gridStep('easy', 0.5)).toBe(0.5) // 120 BPM
    expect(gridStep('easy', 1.0)).toBe(0.25) // 60 BPM
    expect(gridStep('medium', 0.5)).toBe(0.25)
    expect(gridStep('medium', 1.2)).toBe(0.125)
  })

  it('a slow song keeps its sixteenth notes on Easy', () => {
    const g = grid(60)
    // melody on every sixteenth of beat 1 (0, 0.25, 0.5, 0.75 s)
    const arr = arrange([0, 0.25, 0.5, 0.75].map((t, i) => note(t, 64 + i)), g, { output: 'melody', difficulty: 'easy', transpose: 0, autoTranspose: false, quantize: true })
    expect(arr.notes.map((n) => n.startBeat)).toEqual([0, 0.25, 0.5, 0.75])
  })
})

describe('triplet feel', () => {
  const g = grid(100)
  const beat = 0.6
  it('detects shuffle / 12/8 from notes on the thirds of the beat', () => {
    const swung: RawNote[] = []
    for (let b = 0; b < 16; b++) swung.push(note(b * beat), note(b * beat + (beat * 2) / 3, 67))
    expect(detectFeel(swung, g.beats)).toBe('triplet')
    const straight: RawNote[] = []
    for (let b = 0; b < 16; b++) straight.push(note(b * beat), note(b * beat + beat / 2, 67))
    expect(detectFeel(straight, g.beats)).toBe('straight')
  })

  it('snaps triplet songs to a triplet grid', () => {
    const swung: RawNote[] = []
    for (let b = 0; b < 8; b++) swung.push(note(b * beat + 0.01, 60 + b), note(b * beat + (beat * 2) / 3 - 0.01, 72))
    const arr = arrange(swung, g, { output: 'melody', difficulty: 'medium', transpose: 0, autoTranspose: false, quantize: true })
    expect(arr.feel).toBe('triplet')
    for (const n of arr.notes) expect(Math.abs(n.startBeat * 3 - Math.round(n.startBeat * 3))).toBeLessThan(1e-6)
  })
})

describe('manual rhythm fixes', () => {
  const g = grid(120, 17) // beats every 0.5 s
  it('double and half speed', () => {
    const dbl = adjustGrid(g, { tempoScale: 2 })
    expect(dbl.bpm).toBe(240)
    expect(dbl.beats.slice(0, 3)).toEqual([0, 0.25, 0.5])
    const half = adjustGrid(g, { tempoScale: 0.5 })
    expect(half.bpm).toBe(60)
    expect(half.beats.slice(0, 3)).toEqual([0, 1, 2])
  })

  it('moving the bar line keeps every note and starts a bar earlier', () => {
    const shifted = adjustGrid(g, { barShift: 1 })
    expect(shifted.beats[0]).toBeCloseTo(-1.5) // 3 beats of lead-in, so the old beat 2 is a bar line
    expect(shifted.beats[4]).toBeCloseTo(0.5)
    const arr = arrange([note(0), note(0.5, 66)], g, { output: 'melody', difficulty: 'medium', transpose: 0, autoTranspose: false, quantize: true, barShift: 1 })
    expect(arr.notes.map((n) => n.startBeat)).toEqual([3, 4])
  })

  it('3 beats in a bar is written to the MIDI file', () => {
    const arr = arrange([note(0), note(0.5, 66), note(1, 67)], g, { output: 'chords', difficulty: 'easy', transpose: 0, autoTranspose: false, quantize: true, beatsPerBar: 3 })
    expect(arr.beatsPerBar).toBe(3)
    const midi = new Midi(buildMidi(arr, 'waltz'))
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([3, 4])
  })
})

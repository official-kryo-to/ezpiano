import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { arrange } from '../src/engine/arrange'
import { buildMidi, midiFileName } from '../src/engine/midi'
import { detectProfile, profileById } from '../src/lib/keyboards'
import type { BeatGrid, RawNote } from '../src/engine/types'

describe('keyboard auto-detection from the USB device name', () => {
  it.each([
    ['Digital Keyboard', 'yamaha-ez220'],
    ['Digital Keyboard-1', 'yamaha-ez220'],
    ['EZ-300', 'yamaha-ez300'],
    ['CASIO USB-MIDI', 'casio-lk'],
    ['Keystation 88 MK3', 'keys-88'],
    ['Launchkey 49 MK3 LKMK3 MIDI Port', 'keys-49'],
    ['MPK mini 3', 'keys-25'],
    ['Roland Digital Piano', 'keys-88'],
    ['Some USB MIDI Device', 'keys-61'],
  ])('%s -> %s', (name, id) => {
    expect(detectProfile(name).id).toBe(id)
  })
})

const grid: BeatGrid = { bpm: 120, beats: Array.from({ length: 64 }, (_, i) => i * 0.5), steady: true }
const wide: RawNote[] = [
  { pitch: 24, start: 0, end: 0.4, velocity: 80 }, // C1
  { pitch: 76, start: 0, end: 0.4, velocity: 100 }, // E5
  { pitch: 103, start: 1, end: 1.4, velocity: 100 }, // G7
  { pitch: 30, start: 1, end: 1.4, velocity: 80 },
]

describe('profiles change range, channels and file name', () => {
  it('88 keys keep notes that a 61-key keyboard has to fold', () => {
    const p88 = profileById('keys-88')!
    const arr = arrange(wide, grid, { output: 'full', difficulty: 'original', transpose: 0, autoTranspose: false, quantize: true, range: { low: p88.low, high: p88.high } })
    expect(arr.notes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([24, 30, 76, 103])
    const arr61 = arrange(wide, grid, { output: 'full', difficulty: 'original', transpose: 0, autoTranspose: false, quantize: true })
    for (const n of arr61.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(36)
      expect(n.pitch).toBeLessThanOrEqual(96)
    }
  })

  it('a 25-key keyboard folds everything into C3..C5', () => {
    const p = profileById('keys-25')!
    const arr = arrange(wide, grid, { output: 'full', difficulty: 'original', transpose: 0, autoTranspose: false, quantize: true, range: { low: p.low, high: p.high } })
    for (const n of arr.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(48)
      expect(n.pitch).toBeLessThanOrEqual(72)
    }
  })

  it('Casio LK files put the right hand on channel 4 and the left on channel 3', () => {
    const casio = profileById('casio-lk')!
    const arr = arrange(wide, grid, { output: 'full', difficulty: 'original', transpose: 0, autoTranspose: false, quantize: true })
    const midi = new Midi(buildMidi(arr, 'test', casio.file))
    const [rh, lh] = midi.tracks
    expect(rh.name).toBe('Right Hand')
    expect(rh.channel).toBe(3)
    expect(lh.channel).toBe(2)
    expect(midiFileName('song.mp3', casio.short)).toBe('song_casio-lk.mid')
  })
})

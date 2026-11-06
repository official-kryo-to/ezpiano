import { describe, expect, it } from 'vitest'
import { cleanNotes, removeEchoes } from '../src/engine/cleanup'
import type { RawNote } from '../src/engine/types'

const note = (start: number, velocity: number, pitch = 47): RawNote => ({ pitch, start, end: start + 0.15, velocity })

describe('echo removal', () => {
  it('merges a delay-effect echo chain (even spacing, fading) into the played note', () => {
    const echo = [note(1, 80), note(1.18, 64), note(1.36, 51), note(1.54, 41), note(1.72, 33)]
    const out = removeEchoes(echo)
    expect(out).toHaveLength(1)
    expect(out[0].start).toBe(1)
    expect(out[0].end).toBeCloseTo(1.87)
  })

  it('keeps real repeated notes that do not fade', () => {
    const repeats = [note(1, 80), note(1.25, 78), note(1.5, 82), note(1.75, 79)]
    expect(removeEchoes(repeats)).toHaveLength(4)
  })

  it('keeps a quieter repeat that comes much later', () => {
    expect(removeEchoes([note(1, 80), note(2, 50)])).toHaveLength(2)
  })

  it('keeps short staccato notes in fast playing', () => {
    const fast = Array.from({ length: 16 }, (_, i) => ({ pitch: 60 + (i % 5), start: i * 0.12, end: i * 0.12 + 0.04, velocity: 70 }))
    expect(cleanNotes(fast)).toHaveLength(16)
  })
})

describe('speed: silent windows', () => {
  it('detects near-silence and nothing else', async () => {
    const { isSilent } = await import('../src/engine/transcribe')
    expect(isSilent(new Float32Array(160000))).toBe(true)
    const quietNoise = new Float32Array(160000).map(() => (Math.random() - 0.5) * 0.0015)
    expect(isSilent(quietNoise)).toBe(true)
    const music = new Float32Array(160000)
    music[80000] = 0.05
    expect(isSilent(music)).toBe(false)
  })
})

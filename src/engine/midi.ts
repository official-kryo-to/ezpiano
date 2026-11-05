import { Midi } from '@tonejs/midi'
import type { Arrangement } from './types'

export const RH_CHANNEL = 0 // MIDI channel 1: the only channel the EZ-220 lights keys for
export const LH_CHANNEL = 1 // MIDI channel 2

/**
 * Type 1 MIDI with two tracks ("Right Hand" on channel 1, "Left Hand" on channel 2), both
 * Acoustic Grand Piano. Notes are placed on the beat grid, so bars line up in any DAW.
 * Steady performances get one tempo; drifting ones get a tempo map that follows the player.
 */
export function buildMidi(arr: Arrangement, title: string): Uint8Array {
  const midi = new Midi()
  midi.header.name = title
  const ppq = midi.header.ppq
  const { grid } = arr

  midi.header.tempos = []
  if (grid.steady || grid.beats.length < 3) {
    midi.header.tempos.push({ ticks: 0, bpm: grid.bpm })
  } else {
    let last = 0
    for (let i = 0; i + 1 < grid.beats.length; i++) {
      const bpm = Math.round((60 / (grid.beats[i + 1] - grid.beats[i])) * 100) / 100
      if (i === 0 || Math.abs(bpm - last) / last > 0.01) {
        midi.header.tempos.push({ ticks: i * ppq, bpm: i === 0 ? grid.bpm : bpm })
        last = i === 0 ? grid.bpm : bpm
      }
    }
  }
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [4, 4], measures: 0 }]
  midi.header.update()

  const rh = midi.addTrack()
  rh.name = 'Right Hand'
  rh.channel = RH_CHANNEL
  rh.instrument.number = 0
  const lh = midi.addTrack()
  lh.name = 'Left Hand'
  lh.channel = LH_CHANNEL
  lh.instrument.number = 0

  for (const n of arr.notes) {
    const ticks = Math.round(n.startBeat * ppq)
    const durationTicks = Math.max(1, Math.round(n.endBeat * ppq) - ticks)
    ;(n.hand === 'R' ? rh : lh).addNote({ midi: n.pitch, ticks, durationTicks, velocity: (n.velocity + 0.4) / 127 }) // tonejs floors velocity*127
  }
  return midi.toArray()
}

export function midiFileName(original: string): string {
  const base = original.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'song'
  return `${base}_ez220.mid`
}

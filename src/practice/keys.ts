/**
 * Key presses from every source: the on-screen keyboard, the computer keyboard and the real
 * keyboard over MIDI. On-screen and computer keys make a sound in the app; the real keyboard
 * already sounds by itself, so its presses are never echoed by the app.
 */
import { audio } from '../lib/audio'
import { midi } from '../lib/midi'

export type KeySource = 'screen' | 'computer' | 'midi'
type Listener = (e: { type: 'on' | 'off'; note: number; source: KeySource }) => void

class Keys {
  private listeners = new Set<Listener>()
  readonly held = new Set<number>()

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  press(note: number, source: KeySource, velocity = 0.8) {
    if (this.held.has(note)) this.release(note, source)
    this.held.add(note)
    if (source !== 'midi') audio.noteOn(note, velocity)
    this.listeners.forEach((l) => l({ type: 'on', note, source }))
  }

  release(note: number, source: KeySource) {
    if (!this.held.has(note)) return
    this.held.delete(note)
    if (source !== 'midi') audio.noteOff(note)
    this.listeners.forEach((l) => l({ type: 'off', note, source }))
  }

  releaseAll() {
    for (const n of [...this.held]) this.release(n, 'screen')
  }
}

export const keys = new Keys()

midi.onKey((e) => (e.type === 'on' ? keys.press(e.note, 'midi', e.velocity / 127) : keys.release(e.note, 'midi')))

/* computer keyboard: A W S E D F T G Y H U J K O L P ; ' from C4, Z / X shift octave */
const ROW = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"]
let octave = 4
const down = new Map<string, number>()

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

export function installComputerKeys() {
  const kd = (e: KeyboardEvent) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'z') octave = Math.max(2, octave - 1)
    else if (k === 'x') octave = Math.min(6, octave + 1)
    const i = ROW.indexOf(k)
    if (i < 0 || e.repeat || down.has(k)) return
    const note = (octave + 1) * 12 + i
    down.set(k, note)
    keys.press(note, 'computer')
  }
  const ku = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    const note = down.get(k)
    if (note == null) return
    down.delete(k)
    keys.release(note, 'computer')
  }
  const blur = () => {
    down.clear()
    keys.releaseAll()
  }
  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)
  window.addEventListener('blur', blur)
  return () => {
    window.removeEventListener('keydown', kd)
    window.removeEventListener('keyup', ku)
    window.removeEventListener('blur', blur)
  }
}

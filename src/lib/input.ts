import { audio } from './audio'

export type InputSource = 'touch' | 'keyboard' | 'midi'
export interface NoteInput {
  type: 'on' | 'off'
  midi: number
  velocity: number
  source: InputSource
}
type Listener = (e: NoteInput) => void

/**
 * One bus for every way of playing a note: on-screen keys, computer keyboard, MIDI keyboard.
 * Plays the sound and tells subscribers (practice + lessons) what was pressed.
 */
class InputBus {
  private listeners = new Set<Listener>()
  readonly held = new Set<number>()
  sound = true

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  press(midi: number, velocity = 0.8, source: InputSource = 'touch') {
    if (this.held.has(midi)) this.release(midi, source)
    this.held.add(midi)
    if (this.sound) audio.noteOn(midi, velocity)
    this.listeners.forEach((l) => l({ type: 'on', midi, velocity, source }))
  }

  release(midi: number, source: InputSource = 'touch') {
    if (!this.held.has(midi)) return
    this.held.delete(midi)
    audio.noteOff(midi)
    this.listeners.forEach((l) => l({ type: 'off', midi, velocity: 0, source }))
  }

  releaseAll() {
    for (const m of [...this.held]) this.release(m)
  }
}

export const input = new InputBus()

/* ---------------- computer keyboard ---------------- */

const KEY_ROW = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"]
let kbdOctave = 4
const kbdHeld = new Map<string, number>()
const octaveListeners = new Set<(o: number) => void>()

export function setKeyboardOctave(o: number) {
  kbdOctave = Math.max(1, Math.min(7, o))
  octaveListeners.forEach((l) => l(kbdOctave))
}
export const getKeyboardOctave = () => kbdOctave
export function onKeyboardOctave(fn: (o: number) => void) {
  octaveListeners.add(fn)
  return () => {
    octaveListeners.delete(fn)
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

export function installComputerKeyboard() {
  const down = (e: KeyboardEvent) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'z') return setKeyboardOctave(kbdOctave - 1)
    if (k === 'x') return setKeyboardOctave(kbdOctave + 1)
    const i = KEY_ROW.indexOf(k)
    if (i < 0 || e.repeat || kbdHeld.has(k)) return
    const midi = (kbdOctave + 1) * 12 + i
    kbdHeld.set(k, midi)
    input.press(midi, 0.8, 'keyboard')
  }
  const up = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    const midi = kbdHeld.get(k)
    if (midi == null) return
    kbdHeld.delete(k)
    input.release(midi, 'keyboard')
  }
  const blur = () => {
    kbdHeld.clear()
    input.releaseAll()
  }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
  }
}

/** Label of the computer key for a midi note (for on-screen hints), if in range. */
export function computerKeyFor(midi: number): string | null {
  const i = midi - (kbdOctave + 1) * 12
  return i >= 0 && i < KEY_ROW.length ? KEY_ROW[i].toUpperCase() : null
}

/* ---------------- Web MIDI ---------------- */

export type MidiState = { supported: boolean; devices: string[]; error?: string }
const midiListeners = new Set<(s: MidiState) => void>()
let midiState: MidiState = { supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator, devices: [] }
let midiStarted = false

export function onMidiState(fn: (s: MidiState) => void) {
  midiListeners.add(fn)
  fn(midiState)
  return () => {
    midiListeners.delete(fn)
  }
}

function setMidiState(s: MidiState) {
  midiState = s
  midiListeners.forEach((l) => l(s))
}

export async function connectMidi() {
  if (!midiState.supported || midiStarted) return
  midiStarted = true
  try {
    const access = await navigator.requestMIDIAccess()
    const handler = (ev: MIDIMessageEvent) => {
      const d = ev.data
      if (!d || d.length < 2) return
      const cmd = d[0] & 0xf0
      const note = d[1]
      const vel = d[2] ?? 0
      if (cmd === 0x90 && vel > 0) input.press(note, vel / 127, 'midi')
      else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) input.release(note, 'midi')
    }
    const refresh = () => {
      const names: string[] = []
      access.inputs.forEach((inp) => {
        inp.onmidimessage = handler
        names.push(inp.name || 'MIDI keyboard')
      })
      setMidiState({ ...midiState, devices: names, error: undefined })
    }
    access.onstatechange = refresh
    refresh()
  } catch (err) {
    midiStarted = false
    setMidiState({ ...midiState, error: err instanceof Error ? err.message : 'MIDI access denied' })
  }
}
